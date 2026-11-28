import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DateTime, IANAZone } from 'luxon';
import { SupabaseService } from '../common/supabase.service';
import { AuditService } from '../common/audit.service';
import type { AuthUser } from '../common/auth.guard';
import { computeNextRun, expandOccurrences } from './recurrence';

export const scheduleInput = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    action_type: z.enum(['notify', 'report', 'email', 'chat_message']),
    action_payload: z.record(z.unknown()).default({}),
    channel: z.enum(['push', 'telegram', 'email', 'in_app']).default('push'),
    recurrence: z.enum(['once', 'daily', 'weekly', 'monthly', 'cron']),
    run_at: z.string().datetime().optional(),
    time_of_day: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    day_of_month: z.number().int().min(1).max(31).optional(),
    cron_expr: z.string().max(120).optional(),
    timezone: z.string().default('UTC'),
    enabled: z.boolean().default(true),
    requires_confirmation: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const need = (cond: boolean, msg: string) => {
      if (!cond) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
    };
    if (v.recurrence === 'once') need(!!v.run_at, 'run_at is required for a one-off schedule');
    if (v.recurrence === 'daily') need(!!v.time_of_day, 'time_of_day is required');
    if (v.recurrence === 'weekly')
      need(!!v.time_of_day && !!v.days?.length, 'time_of_day and at least one weekday are required');
    if (v.recurrence === 'monthly')
      need(!!v.time_of_day && !!v.day_of_month, 'time_of_day and day_of_month are required');
    if (v.recurrence === 'cron') need(!!v.cron_expr, 'cron_expr is required');

  });

/**
 * What a schedule of each mode must say, or it would fire empty. Checked on
 * create and whenever an active schedule is saved — not on a pause, so a
 * legacy row can always be paused. A reminder may fall back to its name.
 * Pure; unit-tested.
 */
export function contentProblem(input: {
  action_type: string;
  action_payload?: Record<string, unknown>;
}): string | null {
  const p = input.action_payload ?? {};
  const has = (key: string) => typeof p[key] === 'string' && (p[key] as string).trim().length > 0;
  if (input.action_type === 'chat_message' && !has('prompt') && !has('text')) {
    return 'Describe what the AI should do.';
  }
  if (input.action_type === 'email') {
    const to = typeof p.to === 'string' ? p.to.trim() : '';
    if (!z.string().email().safeParse(to).success) return 'Enter a valid email address to send to.';
    if (!has('prompt')) return 'Describe what the email should say.';
  }
  return null;
}

/** Clock skew allowance when checking that a one-off is in the future. */
const PAST_GRACE_MS = 60_000;

/**
 * A one-off whose moment has already passed would be created disabled and
 * never run — silently. Reject it with a reason instead. Pure; unit-tested.
 */
export function oneOffInPast(input: { recurrence: string; run_at?: string }, now = Date.now()): boolean {
  if (input.recurrence !== 'once' || !input.run_at) return false;
  const at = new Date(input.run_at).getTime();
  return Number.isFinite(at) && at < now - PAST_GRACE_MS;
}

/**
 * Which schedules the phone arms as its own local notifications. Only "Remind
 * me" (and the legacy brief): an AI message or an email must not ping the
 * phone at the scheduled minute claiming something happened — the agent
 * notifies when the work is actually done (or failed). Pure; unit-tested.
 */
export function armsOnPhone(actionType: string): boolean {
  return actionType === 'notify' || actionType === 'report';
}

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export type ScheduleInput = z.infer<typeof scheduleInput>;


/** The subset of a schedule row the occurrence expander needs. */
interface ScheduleRowShape {
  id: string;
  name: string;
  action_type: 'notify' | 'report' | 'email' | 'chat_message';
  action_payload: Record<string, unknown> | null;
  recurrence: 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';
  run_at: string | null;
  time_of_day: string | null;
  day_of_month: number | null;
  cron_expr: string | null;
  timezone: string;
  enabled: boolean;
  assistant_schedule_days: { day_of_week: number }[] | null;
}

const SELECT = '*, assistant_schedule_days(day_of_week)';

/** The words of a reminder, whichever key an older row stored them under. */
function reminderBody(payload: Record<string, unknown> | null): string | null {
  for (const key of ['body', 'message', 'text', 'prompt']) {
    const v = payload?.[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/** The flat occurrence shape the phone arms notifications from. */
interface ScheduleOccurrenceOut {
  id: string;
  schedule_id: string;
  name: string;
  action_type: 'notify' | 'report' | 'email' | 'chat_message';
  title: string;
  body: string | null;
  at: string;
  kind: 'schedule' | 'calendar';
  deeplink: 'today' | 'calendar' | 'assistant' | 'schedules';
  deeplink_id?: string;
  deeplink_at?: string;
}

/** A calendar row is an appointment (`event`) or a nudge (`reminder`) — 0025. */
export type CalendarKind = 'event' | 'reminder';

/** When an all-day item reminds on its day, local time. */
export const ALL_DAY_REMINDER_HOUR = 9;

/**
 * The minutes-before a timed calendar item should remind.
 *
 * - The user chose a "Remind before" (a custom `event_reminders` row): that
 *   lead **and** the moment itself. Nothing they did not ask for.
 * - Nothing chosen: an event keeps the baseline the product always promised,
 *   **one hour before and at the start**; a reminder fires at its time.
 *
 * Pure and exported so the timing rule is unit-tested without a database.
 */
export function calendarReminderLeads(
  allDay: boolean,
  custom: number[],
  kind: CalendarKind = 'event',
): number[] {
  const valid = custom.filter((m) => Number.isFinite(m) && m >= 0);
  if (allDay) return [0];
  const base = valid.length ? [0] : kind === 'reminder' ? [0] : [0, 60];
  return [...new Set([...base, ...valid])].sort((a, b) => a - b);
}

/**
 * The instants a calendar item should notify, newest last.
 *
 * `remindAt = start − lead`. An all-day item has no start time, so it is
 * anchored to a **morning reminder** — 09:00 in the user's zone on its date —
 * and only whole-day leads move it ("1 day before" = 09:00 the day before);
 * a sub-day lead on an all-day item collapses onto the anchor rather than
 * firing at a meaningless hour. All-day rows are stored as UTC midnight of
 * their date, so the date is read in UTC and the hour applied in `timezone`.
 */
export function calendarReminderMoments(
  item: { starts_at: string; all_day?: boolean | null; kind?: CalendarKind | null },
  custom: number[],
  timezone = 'UTC',
): { at: Date; minutesBefore: number }[] {
  const start = new Date(item.starts_at);
  if (!Number.isFinite(start.getTime())) return [];
  const kind = item.kind === 'reminder' ? 'reminder' : 'event';

  if (!item.all_day) {
    return calendarReminderLeads(false, custom, kind).map((minutesBefore) => ({
      at: new Date(start.getTime() - minutesBefore * 60_000),
      minutesBefore,
    }));
  }

  const zone = IANAZone.isValidZone(timezone) ? timezone : 'UTC';
  const date = item.starts_at.slice(0, 10);
  const anchor = DateTime.fromISO(date, { zone }).set({ hour: ALL_DAY_REMINDER_HOUR });
  if (!anchor.isValid) return [];
  const days = new Set([0]);
  for (const m of custom) if (Number.isFinite(m) && m > 0 && m % 1440 === 0) days.add(m / 1440);
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => ({ at: anchor.minus({ days: d }).toJSDate(), minutesBefore: d * 1440 }));
}

/** Human lead-time for a calendar reminder's body, e.g. "In 1 hour · Office". */
export function calendarBody(minutesBefore: number, location: string | null): string {
  const where = location ? ` · ${location}` : '';
  if (minutesBefore === 0) return `Starting now${where}`;
  if (minutesBefore % 1440 === 0) {
    const d = minutesBefore / 1440;
    return `In ${d} day${d === 1 ? '' : 's'}${where}`;
  }
  if (minutesBefore % 60 === 0) {
    const h = minutesBefore / 60;
    return `In ${h} hour${h === 1 ? '' : 's'}${where}`;
  }
  if (minutesBefore < 60) return `In ${minutesBefore} minute${minutesBefore === 1 ? '' : 's'}${where}`;
  const h = Math.floor(minutesBefore / 60);
  const m = minutesBefore % 60;
  return `In ${h}h ${m}m${where}`;
}

/**
 * The body of a calendar notification. A reminder at its moment shows its note
 * (or simply "Now"); an all-day item's morning reminder says "Today".
 */
export function calendarItemBody(
  item: { all_day?: boolean | null; kind?: CalendarKind | null; location: string | null; description?: string | null },
  minutesBefore: number,
): string {
  const where = item.location ? ` · ${item.location}` : '';
  const note = item.description?.trim();
  if (item.all_day) {
    const when = minutesBefore === 0 ? 'Today' : minutesBefore === 1440 ? 'Tomorrow' : calendarBody(minutesBefore, null);
    return `${when}${where}${note && minutesBefore === 0 ? ` · ${note}` : ''}`;
  }
  if (item.kind === 'reminder' && minutesBefore === 0) return note || `Now${where}`;
  return calendarBody(minutesBefore, item.location);
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const db = this.supabase.forUser(user.token);
    const { data, error } = await db
      .from('assistant_schedules')
      .select(SELECT)
      .order('next_run_at', { ascending: true, nullsFirst: false });
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as { id: string }[];
    if (!rows.length) return rows;

    // The latest run per schedule, so the list can show "Sent", "Failed —
    // retrying", "Waiting for approval" without a request per row.
    const { data: runs } = await db
      .from('schedule_runs')
      .select('schedule_id, status, detail, ran_at')
      .in('schedule_id', rows.map((r) => r.id))
      .order('ran_at', { ascending: false })
      .limit(500);
    const latest = new Map<string, unknown>();
    for (const run of (runs ?? []) as { schedule_id: string }[]) {
      if (!latest.has(run.schedule_id)) latest.set(run.schedule_id, run);
    }
    return rows.map((r) => ({ ...r, last_run: latest.get(r.id) ?? null }));
  }

  /** Email schedules need a mailbox that may send; say so at creation, not at 08:30. */
  private async assertCanSendEmail(user: AuthUser, input: ScheduleInput): Promise<void> {
    if (input.action_type !== 'email' || !input.enabled) return;
    const db = this.supabase.forUser(user.token);
    const { data } = await db.from('gmail_accounts').select('scopes');
    const canSend = ((data ?? []) as { scopes: string | null }[]).some((r) =>
      (r.scopes ?? '').split(/\s+/).includes(GMAIL_SEND_SCOPE),
    );
    if (!canSend) {
      throw new BadRequestException(
        'Email schedules need Gmail connected with send access — connect it in Settings → Mail.',
      );
    }
  }

  private assertRunnable(input: ScheduleInput): Date | null {
    const problem = contentProblem(input);
    if (problem) throw new BadRequestException(problem);
    if (oneOffInPast(input)) {
      throw new BadRequestException('That time has already passed — pick a time in the future.');
    }
    const next = computeNextRun({ ...input, days: input.days });
    if (input.enabled && !next) {
      throw new BadRequestException('That schedule never runs — check the date and time.');
    }
    return next;
  }

  async create(user: AuthUser, input: ScheduleInput) {
    const db = this.supabase.forUser(user.token);
    const next = this.assertRunnable(input);
    await this.assertCanSendEmail(user, input);

    const { days, ...row } = input;
    const { data, error } = await db
      .from('assistant_schedules')
      .insert({ ...row, user_id: user.id, next_run_at: next?.toISOString() ?? null })
      .select('id')
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.replaceDays(user, data.id, days);
    await this.audit.record({
      userId: user.id,
      actor: 'user',
      action: 'schedule.create',
      targetType: 'assistant_schedule',
      targetId: data.id,
      detail: { action_type: input.action_type, recurrence: input.recurrence },
    });
    return this.get(user, data.id);
  }

  async get(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    const { data, error } = await db.from('assistant_schedules').select(SELECT).eq('id', id).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Schedule not found');
    return data;
  }

  async update(user: AuthUser, id: string, input: ScheduleInput) {
    const db = this.supabase.forUser(user.token);
    await this.get(user, id); // 404s if not the caller's row (RLS)

    // Pausing a finished one-off is fine; *enabling* one in the past is not.
    const next = input.enabled ? this.assertRunnable(input) : computeNextRun({ ...input, days: input.days });
    await this.assertCanSendEmail(user, input);
    const { days, ...row } = input;

    const { error } = await db
      .from('assistant_schedules')
      // An edit starts a fresh occurrence: reset any retry in progress.
      .update({ ...row, next_run_at: input.enabled ? (next?.toISOString() ?? null) : null, deferred_count: 0 })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);

    await this.replaceDays(user, id, days);
    await this.audit.record({
      userId: user.id,
      actor: 'user',
      action: 'schedule.update',
      targetType: 'assistant_schedule',
      targetId: id,
    });
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    const { error } = await db.from('assistant_schedules').delete().eq('id', id);
    if (error) throw new BadRequestException(error.message);
    await this.audit.record({
      userId: user.id,
      actor: 'user',
      action: 'schedule.delete',
      targetType: 'assistant_schedule',
      targetId: id,
    });
    return { ok: true };
  }

  /**
   * Flattened occurrences for the next `hours` (Phase 11.2).
   *
   * This is what makes the phone the clock. The app asks for the moments,
   * registers a local notification for each one, and the OS fires them with
   * the laptop shut and this very service asleep. Re-arming on every launch
   * is what keeps the window rolling.
   *
   * Deliberately flat and minimal: a notification needs a time, something to
   * say, and an id to deduplicate against on the next sync. Nothing else
   * about the schedule belongs on the device.
   */
  async upcoming(user: AuthUser, hours: number, tz?: string) {
    const rows = (await this.list(user)) as ScheduleRowShape[];
    const from = new Date();
    const until = new Date(from.getTime() + hours * 3600_000);

    const scheduleOccurrences = rows
      .filter((s) => s.enabled && armsOnPhone(s.action_type))
      .flatMap((s) =>
        expandOccurrences(
          {
            recurrence: s.recurrence,
            run_at: s.run_at,
            time_of_day: s.time_of_day,
            day_of_month: s.day_of_month,
            cron_expr: s.cron_expr,
            timezone: s.timezone,
            days: (s.assistant_schedule_days ?? []).map((d) => d.day_of_week),
          },
          from,
          until,
        ).map((at) => ({
          /* Stable across syncs: the same occurrence keeps the same id, so a
           * re-arm replaces its notification instead of adding a second. */
          id: `${s.id}:${at.toISOString()}`,
          schedule_id: s.id,
          name: s.name,
          action_type: s.action_type,
          /* The body the phone should show if it has to compose one itself. */
          title: typeof s.action_payload?.title === 'string' && s.action_payload.title.trim()
            ? s.action_payload.title
            : s.name,
          body: reminderBody(s.action_payload),
          at: at.toISOString(),
          kind: 'schedule' as const,
          deeplink: (s.action_type === 'report' ? 'assistant' : 'schedules') as
            | 'assistant'
            | 'schedules',
        })),
      );

    const out = [...scheduleOccurrences, ...(await this.calendarOccurrences(user, from, until, tz))];
    out.sort((a, b) => a.at.localeCompare(b.at));
    return out;
  }

  /**
   * Calendar events as notification moments (Feature: calendar reminders).
   *
   * Each item reminds at its moment plus the "Remind before" lead the user
   * chose; an event with no lead keeps the baseline of one hour before and at
   * the start. All-day items get a morning reminder in the user's zone (`tz`
   * from the device, else the profile) — see `calendarReminderMoments`.
   *
   * The phone arms whatever this returns, so no device change is needed: the
   * same local-notification path that fires the morning brief now fires event
   * reminders too, with the laptop shut.
   */
  private async calendarOccurrences(user: AuthUser, from: Date, until: Date, tz?: string) {
    const db = this.supabase.forUser(user.token);
    // Fetch past the window so a lead-time reminder (up to a day early) for an
    // item just beyond the edge is still caught, and a day behind so an
    // all-day item's morning reminder (stored as UTC midnight) is not missed.
    const fetchFrom = new Date(from.getTime() - 24 * 60 * 60_000);
    const fetchUntil = new Date(until.getTime() + 2 * 24 * 60 * 60_000);
    const zone = tz && IANAZone.isValidZone(tz) ? tz : await this.profileZone(user);
    const query = (columns: string) =>
      db
        .from('calendar_events')
        .select(columns)
        .gte('starts_at', fetchFrom.toISOString())
        .lte('starts_at', fetchUntil.toISOString())
        .order('starts_at');
    const cols = 'id, title, description, starts_at, all_day, location, event_reminders(minutes_before)';
    let { data, error } = await query(`${cols}, kind`);
    // Before migration 0025 there is no `kind` column: read without it.
    if (error && /kind/.test(error.message)) ({ data, error } = await query(cols));
    if (error) throw new BadRequestException(error.message);

    type EventRow = {
      id: string;
      title: string;
      description: string | null;
      starts_at: string;
      all_day: boolean | null;
      location: string | null;
      kind?: CalendarKind | null;
      event_reminders: { minutes_before: number }[] | null;
    };

    const out: ScheduleOccurrenceOut[] = [];
    for (const event of (data ?? []) as unknown as EventRow[]) {
      const moments = calendarReminderMoments(
        event,
        (event.event_reminders ?? []).map((r) => r.minutes_before),
        zone,
      );

      for (const { at, minutesBefore } of moments) {
        // Only moments inside the arming window and still in the future.
        if (at.getTime() <= from.getTime() || at.getTime() > until.getTime()) continue;
        out.push({
          id: `evt:${event.id}:${at.toISOString()}`,
          schedule_id: event.id,
          name: event.title,
          action_type: 'notify',
          title: event.title || (event.kind === 'reminder' ? 'Reminder' : 'Event'),
          body: calendarItemBody(event, minutesBefore),
          at: at.toISOString(),
          kind: 'calendar',
          deeplink: 'calendar',
          // So a tap opens the right day with this very event's sheet.
          deeplink_id: event.id,
          deeplink_at: event.starts_at,
        });
      }
    }
    return out;
  }

  /** The zone saved on the profile, for clients that do not send their own. */
  private async profileZone(user: AuthUser): Promise<string> {
    const { data } = await this.supabase
      .forUser(user.token)
      .from('profiles')
      .select('timezone')
      .eq('user_id', user.id)
      .maybeSingle();
    const tz = (data as { timezone?: string } | null)?.timezone;
    return tz && IANAZone.isValidZone(tz) ? tz : 'UTC';
  }

  async runs(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    const { data, error } = await db
      .from('schedule_runs')
      .select('*')
      .eq('schedule_id', id)
      .order('ran_at', { ascending: false })
      .limit(50);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  private async replaceDays(user: AuthUser, scheduleId: string, days?: number[]) {
    const db = this.supabase.forUser(user.token);
    await db.from('assistant_schedule_days').delete().eq('schedule_id', scheduleId);
    if (!days?.length) return;
    const rows = [...new Set(days)].map((d) => ({ schedule_id: scheduleId, day_of_week: d }));
    const { error } = await db.from('assistant_schedule_days').insert(rows);
    if (error) throw new BadRequestException(error.message);
  }
}
