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

    const out = rows
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
        })),
      );

    out.sort((a, b) => a.at.localeCompare(b.at));
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
