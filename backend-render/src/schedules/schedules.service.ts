import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
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
  deeplink: 'today' | 'calendar' | 'assistant';
  deeplink_id?: string;
  deeplink_at?: string;
}

/**
 * The minutes-before a calendar event should remind. The baseline the product
 * promises is **one hour before and at the start** (`60` and `0`); any custom
 * `event_reminders` are merged in and de-duplicated. An all-day event gets only
 * the at-start moment — "one hour before midnight" is noise.
 *
 * Pure and exported so the timing rule is unit-tested without a database.
 */
export function calendarReminderLeads(allDay: boolean, custom: number[]): number[] {
  const valid = custom.filter((m) => Number.isFinite(m) && m >= 0);
  if (allDay) return [0];
  return [...new Set([0, 60, ...valid])].sort((a, b) => a - b);
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
    return data ?? [];
  }

  async create(user: AuthUser, input: ScheduleInput) {
    const db = this.supabase.forUser(user.token);
    const next = computeNextRun({ ...input, days: input.days });

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

    const next = computeNextRun({ ...input, days: input.days });
    const { days, ...row } = input;

    const { error } = await db
      .from('assistant_schedules')
      .update({ ...row, next_run_at: next?.toISOString() ?? null })
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
  async upcoming(user: AuthUser, hours: number) {
    const rows = (await this.list(user)) as ScheduleRowShape[];
    const from = new Date();
    const until = new Date(from.getTime() + hours * 3600_000);

    const scheduleOccurrences = rows
      .filter((s) => s.enabled)
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
          title: typeof s.action_payload?.title === 'string' ? s.action_payload.title : s.name,
          body: typeof s.action_payload?.body === 'string' ? s.action_payload.body : null,
          at: at.toISOString(),
          kind: 'schedule' as const,
          deeplink: (s.action_type === 'report' ? 'assistant' : 'today') as 'assistant' | 'today',
        })),
      );

    const out = [...scheduleOccurrences, ...(await this.calendarOccurrences(user, from, until))];
    out.sort((a, b) => a.at.localeCompare(b.at));
    return out;
  }

  /**
   * Calendar events as notification moments (Feature: calendar reminders).
   *
   * Every event earns a reminder **one hour before** and **at the start** —
   * that is the baseline the product promises — plus any custom
   * `event_reminders` the user set on it. All_day events get only the at-start
   * moment, because "one hour before midnight" is noise.
   *
   * The phone arms whatever this returns, so no device change is needed: the
   * same local-notification path that fires the morning brief now fires event
   * reminders too, with the laptop shut.
   */
  private async calendarOccurrences(user: AuthUser, from: Date, until: Date) {
    const db = this.supabase.forUser(user.token);
    // Fetch a little past the window so a 1h-before reminder for an event just
    // beyond the edge is still caught.
    const fetchUntil = new Date(until.getTime() + 60 * 60_000);
    const { data, error } = await db
      .from('calendar_events')
      .select('id, title, starts_at, all_day, location, event_reminders(minutes_before)')
      .gte('starts_at', from.toISOString())
      .lte('starts_at', fetchUntil.toISOString())
      .order('starts_at');
    if (error) throw new BadRequestException(error.message);

    type EventRow = {
      id: string;
      title: string;
      starts_at: string;
      all_day: boolean | null;
      location: string | null;
      event_reminders: { minutes_before: number }[] | null;
    };

    const out: ScheduleOccurrenceOut[] = [];
    for (const event of (data ?? []) as EventRow[]) {
      const startsAt = new Date(event.starts_at);
      if (!Number.isFinite(startsAt.getTime())) continue;

      const leads = calendarReminderLeads(
        Boolean(event.all_day),
        (event.event_reminders ?? []).map((r) => r.minutes_before),
      );

      for (const minutesBefore of leads) {
        const at = new Date(startsAt.getTime() - minutesBefore * 60_000);
        // Only moments inside the arming window and still in the future.
        if (at.getTime() <= from.getTime() || at.getTime() > until.getTime()) continue;
        out.push({
          id: `evt:${event.id}:${at.toISOString()}`,
          schedule_id: event.id,
          name: event.title,
          action_type: 'notify',
          title: event.title || 'Event',
          body: calendarBody(minutesBefore, event.location),
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
