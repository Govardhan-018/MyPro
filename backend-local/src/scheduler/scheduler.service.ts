import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../common/supabase.service';
import { AuditService } from '../common/audit.service';
import { LlmService } from '../llm/llm.service';
import { PushService } from '../notifications/push.service';
import { computeNextRun, type Recurrence } from '../schedules/recurrence';
import { env } from '../config/env';

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
  next_run_at: string | null;
  assistant_schedule_days: { day_of_week: number }[] | null;
}

type RunStatus = 'success' | 'failed' | 'skipped' | 'pending_confirmation' | 'deferred';

/** Most rows due at once after a long sleep; keep each pass bounded. */
const BATCH_SIZE = 50;

/**
 * The drain loop — Phase 11.1.
 *
 * It used to be an `@Cron` inside backend-render, which Render's free tier
 * puts to sleep: the clock died with the process and the morning brief
 * silently never happened. It lives here now, on the laptop, which is the
 * machine that holds the model key anyway.
 *
 * Two consequences of the move, both deliberate:
 *
 *  1. **No deferring.** Render had to defer a job that needed generated text
 *     and hope the laptop woke up. Here the model is in-process, so the only
 *     reason a generation fails is the model itself — and that falls back to
 *     the plain brief immediately rather than waiting ten minutes three times.
 *  2. **Staleness is now a real question.** Render was always awake, so
 *     `next_run_at` never fell far behind. The laptop may have been shut for
 *     three days. A recurring job that is hours overdue is skipped rather than
 *     fired, because "here is your day" at 11pm is not a morning brief — the
 *     phone's own alarm (11.2) is what makes the on-time path work.
 *     A one-shot still fires late: there is no next occurrence to wait for,
 *     so late is strictly better than never.
 */
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
    private readonly llm: LlmService,
    private readonly push: PushService,
  ) {}

  /**
   * The catch-up pass. Everything that fell due while the laptop was shut is
   * sitting in the table with `next_run_at` in the past, so "what is pending"
   * needs no separate queue — it is a WHERE clause.
   */
  async onModuleInit(): Promise<void> {
    if (!env().SCHEDULER_ENABLED) {
      this.logger.log('drain loop disabled (SCHEDULER_ENABLED=false)');
      return;
    }
    this.logger.log('draining anything that fell due while this machine was asleep');
    await this.tick();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (!env().SCHEDULER_ENABLED || this.running) return;
    this.running = true;
    try {
      const { data, error } = await this.supabase.admin
        .from('assistant_schedules')
        .select('*, assistant_schedule_days(day_of_week)')
        .eq('enabled', true)
        .not('next_run_at', 'is', null)
        .lte('next_run_at', new Date().toISOString())
        .order('next_run_at')
        .limit(BATCH_SIZE);

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
    if (this.isStale(s)) {
      const late = this.minutesLate(s);
      this.logger.log(`schedule ${s.id} is ${late} min late — skipping to the next occurrence`);
      await this.advance(s, 'skipped', `missed by ${late} min while this machine was asleep`);
      return;
    }

    let status: RunStatus = 'success';
    let detail = '';

    try {
      switch (s.action_type) {
        case 'notify':
          await this.notify(
            s.user_id,
            this.text(s, 'title') ?? s.name,
            this.text(s, 'body') ?? '',
            s.id,
          );
          break;

        case 'chat_message':
          await this.chatMessage(s.user_id, this.text(s, 'text') ?? s.name, s.id);
          break;

        case 'report':
          detail = await this.report(s);
          break;

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

  // ---- staleness --------------------------------------------------------

  private minutesLate(s: DueSchedule): number {
    if (!s.next_run_at) return 0;
    return Math.round((Date.now() - new Date(s.next_run_at).getTime()) / 60_000);
  }

  /**
   * A recurring job whose moment has well and truly passed. One-shots are
   * never stale — missing them entirely is worse than running them late.
   */
  private isStale(s: DueSchedule): boolean {
    if (s.recurrence === 'once') return false;
    const grace = env().SCHEDULER_STALE_MINUTES;
    if (grace <= 0) return false;
    return this.minutesLate(s) > grace;
  }

  // ---- bookkeeping ------------------------------------------------------

  /** Record the run and arm the next occurrence. */
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

    const { error } = await this.supabase.admin
      .from('assistant_schedules')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: next?.toISOString() ?? null,
        enabled: next !== null,
        deferred_count: 0,
      })
      .eq('id', s.id);

    // If re-arming fails the row stays due and the next tick runs it again.
    // Say so loudly rather than leaving a silent repeat-notification loop.
    if (error) {
      this.logger.error(`could not re-arm schedule ${s.id}: ${error.message}`);
    }

    await this.recordRun(s, status, detail);

    await this.audit.record({
      userId: s.user_id,
      actor: 'system',
      action: 'schedule.execute',
      targetType: 'assistant_schedule',
      targetId: s.id,
      detail: { status, action_type: s.action_type },
    });
  }

  /**
   * Write a row to the run history.
   *
   * The result is checked deliberately: a status the table's check constraint
   * rejects (as 'deferred' was until migration 0007) otherwise disappears
   * without a trace, and the run history quietly lies about what happened.
   * A broken history must not fail the job, so this logs rather than throws.
   */
  private async recordRun(s: DueSchedule, status: RunStatus, detail: string): Promise<void> {
    const { error } = await this.supabase.admin.from('schedule_runs').insert({
      schedule_id: s.id,
      user_id: s.user_id,
      status,
      detail: detail || null,
    });
    if (error) {
      this.logger.error(`could not record run for schedule ${s.id} (${status}): ${error.message}`);
    }
  }

  // ---- actions ----------------------------------------------------------

  private async notify(userId: string, title: string, body: string, scheduleId?: string) {
    await this.push.send(userId, { title, body, kind: 'schedule', scheduleId });
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
    await this.push.send(userId, {
      title: 'MyPro',
      body: text,
      kind: 'schedule',
      deeplink: '/assistant',
      scheduleId,
    });
  }

  /**
   * The brief. The model is right here, so this is a direct call — but Groq's
   * free tier is rate-limited, and a 429 must not cost you the brief. On any
   * model failure it falls through to the plain version, exactly as the
   * degrade path on render used to.
   *
   * @returns a detail string for the run history.
   */
  private async report(s: DueSchedule): Promise<string> {
    const { events, tasks, persona, settings } = await this.briefInputs(s.user_id);

    try {
      const result = await this.llm.generate({
        model: settings?.model ?? undefined,
        temperature: settings?.temperature != null ? Number(settings.temperature) : undefined,
        system:
          `You are ${persona?.name ?? 'MyPro'}, writing a short daily brief.` +
          (persona?.tone ? ` Tone: ${persona.tone}.` : '') +
          (persona?.style_notes ? ` ${persona.style_notes}` : ''),
        messages: [
          {
            role: 'user',
            text:
              `Write my brief as a short friendly message (2-4 sentences, no lists, no greeting fluff). ` +
              `Only use these facts; if there is nothing, say it is a clear day.\n\n` +
              `FACTS: ${JSON.stringify({ events, open_tasks: tasks })}`,
          },
        ],
      });

      const text = result.text.trim();
      if (!text) throw new Error('model returned nothing');
      await this.chatMessage(s.user_id, text, s.id);
      return '';
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`brief generation failed (${reason}) — sending the plain version`);
      await this.chatMessage(s.user_id, this.composePlainBrief(events, tasks), s.id);
      return `model unavailable — sent plain brief (${reason})`;
    }
  }

  /** No-AI version of the brief, used when the model cannot be reached. */
  private composePlainBrief(
    events: Record<string, unknown>[],
    tasks: Record<string, unknown>[],
  ): string {
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
      persona: personaRes.data as {
        name?: string | null;
        tone?: string | null;
        style_notes?: string | null;
      } | null,
      settings: settingsRes.data as { model?: string | null; temperature?: number | null } | null,
    };
  }

  /** Nudge if the user has gone quiet past their own threshold. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async inactivityCheck(): Promise<void> {
    if (!env().SCHEDULER_ENABLED) return;

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

      await this.push.send(p.user_id, {
        title: 'MyPro',
        body: 'Hey — it has been a while. How are you doing?',
        kind: 'nudge',
        deeplink: '/assistant',
      });
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

  // ---- Phase 16: memory refresh + proactive check-ins -------------------

  private static readonly NARRATIVE_MAX_AGE_MS = 7 * 24 * 3600_000;
  private static readonly DAILY_CHECKIN_BUDGET = 3;
  private static readonly CHECKIN_MIN_INTERVAL_MS = 6 * 3600_000;

  /**
   * The weekly narrative (COMPANION_VISION §1). When a user's latest snapshot
   * is older than a week — or missing — regenerate a short third-person sketch
   * of who they are right now; `assistant.service` injects the latest one into
   * every prompt. One generation per user per week, so this stays cheap even
   * though the cron fires hourly.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async narrativeRefresh(): Promise<void> {
    if (!env().SCHEDULER_ENABLED) return;
    const db = this.supabase.admin;
    const { data: personas } = await db
      .from('assistant_persona')
      .select('user_id, name, tone, style_notes');

    for (const p of (personas ?? []) as Persona[]) {
      const { data: latest } = await db
        .from('narrative_snapshots')
        .select('generated_at')
        .eq('user_id', p.user_id)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const age = latest
        ? Date.now() - new Date((latest as { generated_at: string }).generated_at).getTime()
        : Infinity;
      if (age < SchedulerService.NARRATIVE_MAX_AGE_MS) continue;
      await this.refreshNarrative(p);
    }
  }

  private async refreshNarrative(p: Persona): Promise<void> {
    const db = this.supabase.admin;
    const [msgs, commitments, library] = await Promise.all([
      db
        .from('assistant_messages')
        .select('role, content')
        .eq('user_id', p.user_id)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: false })
        .limit(40),
      db
        .from('commitments')
        .select('title, state, due_at')
        .eq('user_id', p.user_id)
        .in('state', ['open', 'at_risk'])
        .limit(20),
      db
        .from('library_items')
        .select('title, type, status')
        .eq('user_id', p.user_id)
        .order('accessed_at', { ascending: false, nullsFirst: false })
        .limit(8),
    ]);

    const conversation = ((msgs.data ?? []) as { role: string; content: string | null }[])
      .reverse()
      .filter((m) => m.content)
      .map((m) => `${m.role}: ${m.content}`)
      .slice(-30);
    const open = (commitments.data ?? []) as Record<string, unknown>[];
    const reading = (library.data ?? []) as Record<string, unknown>[];

    // Don't invent a life out of nothing — skip until there's something to go on.
    if (!conversation.length && !open.length && !reading.length) return;

    try {
      const res = await this.llm.generate({
        system:
          'You write a private, third-person sketch of a person for their AI ' +
          "companion's own memory. 200-300 words, plain prose, present tense. " +
          "Capture what they're working on, what's weighing on them, what " +
          "they're reading, their rhythm, and what they've been avoiding. No " +
          'bullet points, no headings, no advice. Only use the facts given; ' +
          'never invent detail.',
        messages: [
          {
            role: 'user',
            text:
              'Write the current sketch of this person from these facts:\n\n' +
              JSON.stringify({ recent_conversation: conversation, open_commitments: open, reading }),
          },
        ],
      });
      const content = res.text.trim();
      if (!content) return;
      await db.from('narrative_snapshots').insert({ user_id: p.user_id, content });
      this.logger.log(`narrative refreshed for ${p.user_id}`);
    } catch (err) {
      this.logger.warn(
        `narrative refresh failed for ${p.user_id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Derived check-ins (COMPANION_VISION §2/§3). When a commitment's
   * `next_checkin_at` falls due, say something useful about it — but with
   * restraint: a per-user daily budget and a per-commitment cooldown (the next
   * check-in is pushed forward after each nudge). Only for users who left
   * proactivity on. This is the first time the companion speaks unprompted.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async commitmentCheckins(): Promise<void> {
    if (!env().SCHEDULER_ENABLED) return;
    const db = this.supabase.admin;
    const { data: personas } = await db
      .from('assistant_persona')
      .select('user_id, name, tone, style_notes')
      .eq('proactive_enabled', true);

    for (const p of (personas ?? []) as Persona[]) {
      await this.checkinsForUser(p);
    }
  }

  private async checkinsForUser(p: Persona): Promise<void> {
    const db = this.supabase.admin;

    // Daily budget: proactive check-ins already sent to this user today (UTC).
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const { count } = await db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', p.user_id)
      .eq('kind', 'checkin')
      .gte('created_at', dayStart.toISOString());
    let budget = SchedulerService.DAILY_CHECKIN_BUDGET - (count ?? 0);
    if (budget <= 0) return;

    const { data: due } = await db
      .from('commitments')
      .select('id, title, detail, due_at, state')
      .eq('user_id', p.user_id)
      .in('state', ['open', 'at_risk'])
      .not('next_checkin_at', 'is', null)
      .lte('next_checkin_at', new Date().toISOString())
      .order('next_checkin_at')
      .limit(budget);

    for (const c of (due ?? []) as CommitmentDue[]) {
      if (budget <= 0) break;
      await this.checkinOne(p, c);
      budget--;
    }
  }

  private async checkinOne(p: Persona, c: CommitmentDue): Promise<void> {
    const db = this.supabase.admin;
    const now = Date.now();
    const overdue = c.due_at ? new Date(c.due_at).getTime() < now : false;

    const [eventsRes, factsRes] = await Promise.all([
      db
        .from('calendar_events')
        .select('title, starts_at')
        .eq('user_id', p.user_id)
        .gte('starts_at', new Date(now).toISOString())
        .lte('starts_at', new Date(now + 3 * 864e5).toISOString())
        .order('starts_at')
        .limit(10),
      db
        .from('assistant_memory')
        .select('key, value')
        .eq('user_id', p.user_id)
        .order('confidence', { ascending: false, nullsFirst: false })
        .limit(15),
    ]);

    const nudge = await this.composeCheckin(
      p,
      c,
      (eventsRes.data ?? []) as Record<string, unknown>[],
      (factsRes.data ?? []) as Record<string, unknown>[],
      overdue,
    );

    // Deliver as a chat message (kind 'checkin' so the daily budget can count it).
    const { data: convo } = await db
      .from('assistant_conversations')
      .select('id')
      .eq('user_id', p.user_id)
      .eq('is_primary', true)
      .is('archived_at', null)
      .maybeSingle();
    if (convo) {
      await db.from('assistant_messages').insert({
        user_id: p.user_id,
        conversation_id: (convo as { id: string }).id,
        role: 'assistant',
        content: nudge,
      });
    }
    await this.push.send(p.user_id, {
      title: 'MyPro',
      body: nudge,
      kind: 'checkin',
      deeplink: '/assistant',
    });

    // Cooldown: aim for roughly halfway to the deadline, but never sooner than
    // the minimum interval; with no future deadline, nudge at most daily. An
    // overdue, still-open loop is flagged at_risk so the UI and prompt see it.
    const patch: Record<string, unknown> = {};
    if (overdue && c.state === 'open') patch.state = 'at_risk';
    let nextMs: number;
    if (c.due_at && new Date(c.due_at).getTime() > now) {
      const halfway = now + (new Date(c.due_at).getTime() - now) / 2;
      nextMs = Math.max(halfway, now + SchedulerService.CHECKIN_MIN_INTERVAL_MS);
    } else {
      nextMs = now + 24 * 3600_000;
    }
    patch.next_checkin_at = new Date(nextMs).toISOString();
    await db.from('commitments').update(patch).eq('id', c.id);

    await this.audit.record({
      userId: p.user_id,
      actor: 'system',
      action: 'commitment.checkin',
      targetType: 'commitment',
      targetId: c.id,
      detail: { overdue },
    });
  }

  private async composeCheckin(
    p: Persona,
    c: CommitmentDue,
    events: Record<string, unknown>[],
    facts: Record<string, unknown>[],
    overdue: boolean,
  ): Promise<string> {
    try {
      const res = await this.llm.generate({
        system:
          `You are ${p.name ?? 'MyPro'}, a close-friend assistant.` +
          (p.tone ? ` Tone: ${p.tone}.` : '') +
          (p.style_notes ? ` ${p.style_notes}` : '') +
          ' Write ONE short proactive check-in (1-3 sentences, no greeting, no ' +
          'lists) about a commitment the person made. Be specific and useful: ' +
          'note the deadline, whether any time is blocked for it, and offer one ' +
          'concrete next move. If it is overdue, be gentle but honest. Only use ' +
          'the facts given.',
        messages: [
          {
            role: 'user',
            text:
              `COMMITMENT: ${JSON.stringify({ title: c.title, detail: c.detail, due_at: c.due_at, overdue })}\n` +
              `UPCOMING EVENTS: ${JSON.stringify(events)}\n` +
              `WHAT YOU KNOW ABOUT THEM: ${JSON.stringify(facts)}`,
          },
        ],
      });
      const text = res.text.trim();
      if (text) return text;
    } catch (err) {
      this.logger.warn(
        `check-in generation failed (${err instanceof Error ? err.message : String(err)}) — plain nudge`,
      );
    }
    const due = c.due_at ? ` (due ${new Date(c.due_at).toLocaleDateString('en-GB')})` : '';
    return overdue
      ? `About "${c.title}"${due} — it's past due. Want to reschedule it or close it out?`
      : `Checking in on "${c.title}"${due}. How's it going — want me to block some time for it?`;
  }
}

interface Persona {
  user_id: string;
  name?: string | null;
  tone?: string | null;
  style_notes?: string | null;
}

interface CommitmentDue {
  id: string;
  title: string;
  detail: string | null;
  due_at: string | null;
  state: string;
}
