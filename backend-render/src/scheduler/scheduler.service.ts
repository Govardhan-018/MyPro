import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../common/supabase.service';
import { AuditService } from '../common/audit.service';
import { AgentClient, AgentUnavailableError, type AgentPersona } from '../nodes/agent-client.service';
import { computeNextRun, type Recurrence } from '../schedules/recurrence';

interface DueSchedule {
  id: string;
  user_id: string;
  name: string;
  action_type: 'notify' | 'report' | 'email' | 'chat_message';
  action_payload: Record<string, unknown> | null;
  channel: string;
  recurrence: Recurrence;
  run_at: string | null;
  time_of_day: string | null;
  day_of_month: number | null;
  cron_expr: string | null;
  timezone: string;
  requires_confirmation: boolean;
  deferred_count: number;
  assistant_schedule_days: { day_of_week: number }[] | null;
}

type RunStatus = 'success' | 'failed' | 'skipped' | 'pending_confirmation' | 'deferred';

/** How long to wait before retrying a job that needed the offline laptop. */
const DEFER_RETRY_MS = 10 * 60_000;
/** After this many defers, send a plain message rather than keep waiting. */
const MAX_DEFERS = 3;

/**
 * Lives on render because render is always on. Jobs that need generated
 * text are delegated to the laptop agent; while the laptop is asleep they
 * defer a few times and then degrade to a plain, non-AI message.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly agent: AgentClient,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { data, error } = await this.supabase.admin
        .from('assistant_schedules')
        .select('*, assistant_schedule_days(day_of_week)')
        .eq('enabled', true)
        .not('next_run_at', 'is', null)
        .lte('next_run_at', new Date().toISOString())
        .limit(50);

      if (error) {
        this.logger.error(`due-query failed: ${error.message}`);
        return;
      }
      for (const schedule of (data ?? []) as DueSchedule[]) {
        await this.runOne(schedule);
      }
    } finally {
      this.running = false;
    }
  }

  private async runOne(s: DueSchedule): Promise<void> {
    let status: RunStatus = 'success';
    let detail = '';

    try {
      switch (s.action_type) {
        case 'notify':
          await this.notify(s.user_id, this.text(s, 'title') ?? s.name, this.text(s, 'body') ?? '', s.id);
          break;

        case 'chat_message':
          await this.chatMessage(s.user_id, this.text(s, 'text') ?? s.name, s.id);
          break;

        case 'report': {
          try {
            await this.report(s);
          } catch (err) {
            if (err instanceof AgentUnavailableError) {
              await this.deferOrDegrade(s, err.message);
              return; // deferOrDegrade owns re-arming
            }
            throw err;
          }
          break;
        }

        case 'email': {
          const allowed = await this.autoSendAllowed(s.user_id);
          if (s.requires_confirmation || !allowed) {
            status = 'pending_confirmation';
            detail = 'Email send needs your confirmation';
            await this.notify(
              s.user_id,
              `Confirm: ${s.name}`,
              'This scheduled email is waiting for your approval.',
              s.id,
            );
          } else {
            status = 'failed';
            detail = 'Email sending is not wired yet (Gmail phase)';
          }
          break;
        }
      }
    } catch (err) {
      status = 'failed';
      detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`schedule ${s.id} failed: ${detail}`);
    }

    await this.advance(s, status, detail);
  }

  /** Normal completion: record the run and arm the next occurrence. */
  private async advance(s: DueSchedule, status: RunStatus, detail: string): Promise<void> {
    const next = computeNextRun(
      {
        recurrence: s.recurrence,
        run_at: s.run_at,
        time_of_day: s.time_of_day,
        day_of_month: s.day_of_month,
        cron_expr: s.cron_expr,
        timezone: s.timezone,
        days: (s.assistant_schedule_days ?? []).map((d) => d.day_of_week),
      },
      new Date(),
    );

    await this.supabase.admin
      .from('assistant_schedules')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: next?.toISOString() ?? null,
        enabled: next !== null,
        deferred_count: 0,
      })
      .eq('id', s.id);

    await this.supabase.admin.from('schedule_runs').insert({
      schedule_id: s.id,
      user_id: s.user_id,
      status,
      detail: detail || null,
    });

    await this.audit.record({
      userId: s.user_id,
      actor: 'system',
      action: 'schedule.execute',
      targetType: 'assistant_schedule',
      targetId: s.id,
      detail: { status, action_type: s.action_type },
    });
  }

  /** The laptop was unreachable: retry soon, or fall back to a plain message. */
  private async deferOrDegrade(s: DueSchedule, reason: string): Promise<void> {
    const attempts = (s.deferred_count ?? 0) + 1;

    if (attempts <= MAX_DEFERS) {
      await this.supabase.admin
        .from('assistant_schedules')
        .update({
          deferred_count: attempts,
          next_run_at: new Date(Date.now() + DEFER_RETRY_MS).toISOString(),
        })
        .eq('id', s.id);

      await this.supabase.admin.from('schedule_runs').insert({
        schedule_id: s.id,
        user_id: s.user_id,
        status: 'deferred',
        detail: `${reason} — retry ${attempts}/${MAX_DEFERS}`,
      });
      this.logger.warn(`schedule ${s.id} deferred (${attempts}/${MAX_DEFERS}): ${reason}`);
      return;
    }

    const fallback = await this.plainBrief(s.user_id);
    await this.chatMessage(s.user_id, fallback, s.id);
    await this.advance(s, 'success', 'laptop offline — sent plain brief');
  }

  // ---- actions ----------------------------------------------------------

  private async notify(userId: string, title: string, body: string, scheduleId?: string) {
    const { error } = await this.supabase.admin.from('notifications').insert({
      user_id: userId,
      title,
      body,
      kind: 'schedule',
      schedule_id: scheduleId ?? null,
    });
    if (error) throw new Error(error.message);
    // Clients also receive this instantly via Supabase Realtime on `notifications`.
    // TODO(channels): fan out to web-push / FCM / Telegram from device_tokens.
  }

  private async chatMessage(userId: string, text: string, scheduleId: string) {
    const { data: conversation } = await this.supabase.admin
      .from('assistant_conversations')
      .select('id')
      .eq('user_id', userId)
      .eq('is_primary', true)
      .is('archived_at', null)
      .maybeSingle();

    if (conversation) {
      await this.supabase.admin.from('assistant_messages').insert({
        user_id: userId,
        conversation_id: (conversation as { id: string }).id,
        role: 'assistant',
        content: text,
      });
    }
    await this.notify(userId, 'MyPro', text, scheduleId);
  }

  /** Friendly brief, written by the laptop from today's data. */
  private async report(s: DueSchedule) {
    const { events, tasks, persona, settings } = await this.briefInputs(s.user_id);

    const text = await this.agent.complete({
      userId: s.user_id,
      persona: persona ?? {},
      model: settings?.model ?? undefined,
      temperature: settings?.temperature != null ? Number(settings.temperature) : undefined,
      messages: [
        {
          role: 'user',
          content:
            `Write my brief as a short friendly message (2-4 sentences, no lists, no greeting fluff). ` +
            `Only use these facts; if there is nothing, say it is a clear day.\n\n` +
            `FACTS: ${JSON.stringify({ events, open_tasks: tasks })}`,
        },
      ],
    });

    await this.chatMessage(s.user_id, text, s.id);
  }

  /** No-AI version of the brief, used when the laptop stays offline. */
  private async plainBrief(userId: string): Promise<string> {
    const { events, tasks } = await this.briefInputs(userId);
    if (!events.length && !tasks.length) return 'Nothing on the calendar today — a clear day.';
    const parts: string[] = [];
    if (events.length) parts.push(`${events.length} event${events.length === 1 ? '' : 's'} today`);
    if (tasks.length) parts.push(`${tasks.length} open task${tasks.length === 1 ? '' : 's'}`);
    return `Here's your day: ${parts.join(' and ')}.`;
  }

  private async briefInputs(userId: string) {
    const db = this.supabase.admin;
    const since = new Date();
    const until = new Date(since.getTime() + 24 * 60 * 60 * 1000);

    const [eventsRes, tasksRes, personaRes, settingsRes] = await Promise.all([
      db
        .from('calendar_events')
        .select('title, starts_at')
        .eq('user_id', userId)
        .gte('starts_at', since.toISOString())
        .lte('starts_at', until.toISOString())
        .order('starts_at'),
      db.from('tasks').select('title, due_at').eq('user_id', userId).eq('status', 'open').limit(10),
      db
        .from('assistant_persona')
        .select('name, tone, style_notes')
        .eq('user_id', userId)
        .maybeSingle(),
      db.from('assistant_settings').select('model, temperature').eq('user_id', userId).maybeSingle(),
    ]);

    return {
      events: (eventsRes.data ?? []) as Record<string, unknown>[],
      tasks: (tasksRes.data ?? []) as Record<string, unknown>[],
      persona: personaRes.data as AgentPersona | null,
      settings: settingsRes.data as { model?: string | null; temperature?: number | null } | null,
    };
  }

  /** Nudge if the user has gone quiet past their own threshold. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async inactivityCheck(): Promise<void> {
    const db = this.supabase.admin;
    const { data } = await db
      .from('assistant_persona')
      .select('user_id, inactivity_hours, proactive_enabled')
      .eq('proactive_enabled', true);

    for (const p of (data ?? []) as {
      user_id: string;
      inactivity_hours: number | null;
      proactive_enabled: boolean;
    }[]) {
      const { data: activity } = await db
        .from('user_activity')
        .select('last_active_at, inactive_notified_at')
        .eq('user_id', p.user_id)
        .maybeSingle();

      const row = activity as {
        last_active_at: string | null;
        inactive_notified_at: string | null;
      } | null;
      if (!row?.last_active_at) continue;

      const quietMs = Date.now() - new Date(row.last_active_at).getTime();
      if (quietMs < (p.inactivity_hours ?? 10) * 3600_000) continue;

      // Only nudge once per quiet stretch.
      if (
        row.inactive_notified_at &&
        new Date(row.inactive_notified_at).getTime() > new Date(row.last_active_at).getTime()
      ) {
        continue;
      }

      await this.notify(p.user_id, 'MyPro', 'Hey — it has been a while. How are you doing?');
      await db
        .from('user_activity')
        .update({ inactive_notified_at: new Date().toISOString() })
        .eq('user_id', p.user_id);
    }
  }

  // ---- helpers ----------------------------------------------------------

  private text(s: DueSchedule, key: string): string | undefined {
    const v = s.action_payload?.[key];
    return typeof v === 'string' && v.trim() ? v : undefined;
  }

  private async autoSendAllowed(userId: string): Promise<boolean> {
    const { data } = await this.supabase.admin
      .from('assistant_settings')
      .select('allow_auto_send_email')
      .eq('user_id', userId)
      .maybeSingle();
    return Boolean((data as { allow_auto_send_email?: boolean } | null)?.allow_auto_send_email);
  }
}
