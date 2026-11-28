import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../common/supabase.service';
import { AuditService } from '../common/audit.service';
import { LlmService } from '../llm/llm.service';
import { PushService } from '../notifications/push.service';
import { AssistantService } from '../assistant/assistant.service';
import { RenderMailService } from '../gmail/render-mail.service';
import { computeNextRun, type Recurrence } from '../schedules/recurrence';
import { env } from '../config/env';
import { UserSessionBroker } from './user-session.broker';
import {
  afterFailure,
  chatInstruction,
  emailInstruction,
  excerpt,
  parseEmailDraft,
  reminderContent,
} from './run-policy';

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

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
  /** Attempts already made at the current occurrence (0 = first try). */
  deferred_count: number;
  next_run_at: string | null;
  updated_at?: string | null;
  assistant_schedule_days: { day_of_week: number }[] | null;
}

type RunStatus = 'success' | 'failed' | 'skipped' | 'pending_confirmation' | 'retrying';

interface RunOutcome {
  status: RunStatus;
  detail: string;
  /** The AI reply / email subject, kept with the run. */
  result?: string;
  /** For a failure: safe to try again (nothing outward happened). */
  retryable?: boolean;
}

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
    private readonly assistant: AssistantService,
    private readonly mail: RenderMailService,
    private readonly broker: UserSessionBroker,
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
    const attempt = (s.deferred_count ?? 0) + 1;
    const nextOccurrence = this.nextOccurrence(s);

    // Claim before doing anything outward. The row moves on to its next
    // occurrence *first*, conditional on nobody else having moved it: if two
    // agents (or a slow tick overlapping the next) see the same due row, only
    // one wins the claim and only one sends. The price is at-most-once — a
    // crash mid-run loses that run rather than repeating it, which for an
    // email or a notification is the right side to err on.
    if (!(await this.claim(s, nextOccurrence))) return;

    if (this.isStale(s)) {
      const late = this.minutesLate(s);
      this.logger.log(`schedule ${s.id} is ${late} min late — skipping to the next occurrence`);
      await this.finish(s, attempt, {
        status: 'skipped',
        detail: `missed by ${late} min while this machine was asleep`,
      });
      return;
    }

    let outcome: RunOutcome;
    try {
      outcome = await this.execute(s, attempt);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`schedule ${s.id} failed: ${detail}`);
      outcome = { status: 'failed', detail, retryable: true };
    }

    if (outcome.status === 'failed') {
      const plan = afterFailure({
        attempt,
        retryable: Boolean(outcome.retryable),
        now: new Date(),
        nextOccurrence,
      });
      if ('retryAt' in plan) {
        await this.scheduleRetry(s, attempt, plan.retryAt);
        await this.recordRun(s, attempt, {
          status: 'retrying',
          detail: `${outcome.detail} — retrying at ${plan.retryAt.toISOString()}`,
        });
        return;
      }
      await this.notifyFailure(s, outcome.detail);
    }

    await this.finish(s, attempt, outcome);
  }

  /** What one attempt does, by type. Throws only on the unexpected. */
  private async execute(s: DueSchedule, attempt: number): Promise<RunOutcome> {
    switch (s.action_type) {
      case 'notify':
        return this.runReminder(s);
      case 'chat_message':
        return this.runAiMessage(s);
      case 'email':
        return this.runEmail(s, attempt);
      case 'report':
        return { status: 'success', detail: await this.report(s) };
      default:
        return { status: 'failed', detail: `unknown action ${String(s.action_type)}` };
    }
  }

  // ---- 1. Remind me -----------------------------------------------------

  private async runReminder(s: DueSchedule): Promise<RunOutcome> {
    const { title, body } = reminderContent(s);
    const id = await this.push.send(s.user_id, {
      title,
      body,
      kind: 'reminder',
      deeplink: '/schedules',
      scheduleId: s.id,
      // The phone armed this itself (android/src/lib/notifications.ts); a
      // device that did is not pushed a second copy.
      localCopy:
        s.next_run_at && s.updated_at
          ? { dueAt: new Date(s.next_run_at), scheduleUpdatedAt: new Date(s.updated_at) }
          : undefined,
    });
    if (!id) return { status: 'failed', detail: 'could not record the notification', retryable: true };
    return { status: 'success', detail: 'reminder sent', result: excerpt(`${title}: ${body}`) };
  }

  // ---- 2. AI message ----------------------------------------------------

  /**
   * Run the task as if the user had typed it at this moment: the full agent,
   * with its skills, under the user's own row-level security (a short-lived
   * session from {@link UserSessionBroker}). The reply lands in the main chat
   * like any other, and a notification says it is done.
   *
   * If the full agent cannot run (no session could be opened), a plain model
   * completion with the persona answers instead — the run history says which.
   */
  private async runAiMessage(s: DueSchedule): Promise<RunOutcome> {
    const instruction = chatInstruction(s);
    if (instruction.kind === 'text') {
      await this.chatMessage(s.user_id, instruction.text, s.id);
      return { status: 'success', detail: 'message posted', result: excerpt(instruction.text) };
    }

    let reply: string;
    let via = 'agent';
    try {
      reply = await this.broker.withUser(s.user_id, async (user) => {
        const out = await this.assistant.send(user, `⏰ Scheduled task: ${instruction.prompt}`);
        return String((out.message as { content?: string | null } | null)?.content ?? '');
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (/model|rate|429|timeout|unavailable|ECONN|fetch failed/i.test(reason)) {
        // The model itself is down: the fallback would fail the same way.
        return { status: 'failed', detail: `AI unavailable: ${reason}`, retryable: true };
      }
      this.logger.warn(`scheduled AI run ${s.id}: agent path failed (${reason}); answering directly`);
      try {
        reply = await this.directAnswer(s.user_id, instruction.prompt);
        via = 'direct';
      } catch (inner) {
        const why = inner instanceof Error ? inner.message : String(inner);
        return { status: 'failed', detail: `AI unavailable: ${why}`, retryable: true };
      }
    }

    if (!reply.trim()) {
      return { status: 'failed', detail: 'the AI returned an empty reply', retryable: true };
    }

    await this.push.send(s.user_id, {
      title: `Done: ${s.name}`,
      body: excerpt(reply),
      kind: 'schedule_result',
      deeplink: '/assistant',
      scheduleId: s.id,
    });
    return {
      status: 'success',
      detail: via === 'agent' ? 'AI replied in chat' : 'AI replied in chat (without tools)',
      result: excerpt(reply, 500),
    };
  }

  /** The no-tools path: persona + the request, posted to the main chat. */
  private async directAnswer(userId: string, prompt: string): Promise<string> {
    const { persona, settings } = await this.briefInputs(userId);
    const result = await this.llm.generate({
      model: settings?.model ?? undefined,
      temperature: settings?.temperature != null ? Number(settings.temperature) : undefined,
      system:
        `You are ${persona?.name ?? 'MyPro'}, the user's companion, carrying out a task they ` +
        `scheduled earlier. Do it now and reply with the result.` +
        (persona?.tone ? ` Tone: ${persona.tone}.` : ''),
      messages: [{ role: 'user', text: `${prompt}\n\n(It is now ${new Date().toISOString()}.)` }],
    });
    const text = result.text.trim();
    if (!text) throw new Error('model returned nothing');
    await this.postToChat(userId, [
      { role: 'user', content: `⏰ Scheduled task: ${prompt}` },
      { role: 'assistant', content: text },
    ]);
    return text;
  }

  // ---- 3. Email ---------------------------------------------------------

  /**
   * Write the email with the model, then send it from the connected Gmail.
   *
   * Duplicate-safe by construction: the row was claimed before we got here,
   * and a send is retried only when the mail service certainly never got it.
   * A schedule marked "ask me first" drafts the email and parks it in the
   * approvals queue (the same `send_email` approval the assistant uses).
   */
  private async runEmail(s: DueSchedule, attempt: number): Promise<RunOutcome> {
    const instruction = emailInstruction(s);
    if ('error' in instruction) return { status: 'failed', detail: instruction.error };

    const account = await this.sendingAccount(s.user_id);
    if (!account) {
      return {
        status: 'failed',
        detail:
          'No Gmail account with send access is connected. Connect Gmail (read & send) in Settings → Mail.',
      };
    }
    if (!this.mail.configured()) {
      return { status: 'failed', detail: 'Mail sending is not configured on the agent (RENDER_API_URL).' };
    }

    let draft: { subject: string; body: string } | null;
    try {
      draft = await this.draftEmail(s, instruction.prompt, instruction.to, account.email);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { status: 'failed', detail: `AI could not write the email: ${reason}`, retryable: true };
    }
    if (!draft) {
      return { status: 'failed', detail: 'the AI returned an empty email', retryable: true };
    }

    if (s.requires_confirmation) {
      const { error } = await this.supabase.admin.from('pending_actions').insert({
        user_id: s.user_id,
        skill: 'send_email',
        args: { to: instruction.to, subject: draft.subject, body: draft.body },
        summary: `Send "${draft.subject}" to ${instruction.to} (scheduled: ${s.name})`,
      });
      if (error) return { status: 'failed', detail: `could not queue for approval: ${error.message}`, retryable: true };
      await this.push.send(s.user_id, {
        title: `Approve email: ${s.name}`,
        body: `"${draft.subject}" to ${instruction.to} is drafted and waiting for you.`,
        kind: 'schedule_result',
        deeplink: '/assistant',
        scheduleId: s.id,
      });
      return {
        status: 'pending_confirmation',
        detail: 'drafted — waiting for your approval',
        result: excerpt(`${draft.subject} → ${instruction.to}`),
      };
    }

    const sent = await this.mail.send({
      userId: s.user_id,
      to: instruction.to,
      subject: draft.subject,
      body: draft.body,
      accountId: account.id,
    });
    if (!sent.ok) {
      return {
        status: 'failed',
        detail: `email not sent (attempt ${attempt}): ${sent.reason}`,
        retryable: Boolean(sent.retryable),
      };
    }

    await this.push.send(s.user_id, {
      title: `Email sent: ${s.name}`,
      body: `"${draft.subject}" to ${instruction.to}`,
      kind: 'schedule_result',
      deeplink: '/schedules',
      scheduleId: s.id,
    });
    return {
      status: 'success',
      detail: `sent from ${sent.from || account.email} (Gmail id ${sent.id})`,
      result: excerpt(`${draft.subject} → ${instruction.to}`),
    };
  }

  private async draftEmail(
    s: DueSchedule,
    prompt: string,
    to: string,
    from: string,
  ): Promise<{ subject: string; body: string } | null> {
    const { persona, settings } = await this.briefInputs(s.user_id);
    const profile = await this.supabase.admin
      .from('profiles')
      .select('display_name')
      .eq('user_id', s.user_id)
      .maybeSingle();
    const name = (profile.data as { display_name?: string | null } | null)?.display_name ?? null;
    const result = await this.llm.generate({
      model: settings?.model ?? undefined,
      temperature: 0.7,
      system:
        'You write emails on behalf of the user, ready to send as-is. Follow their instructions ' +
        'exactly. Plain text, a natural greeting and sign-off, no placeholders like [Name], ' +
        'no commentary. Reply ONLY with JSON: {"subject": "...", "body": "..."}.' +
        (persona?.tone ? ` Match this tone where it fits: ${persona.tone}.` : ''),
      messages: [
        {
          role: 'user',
          text:
            `Instructions: ${prompt}\n` +
            `To: ${to}\nFrom: ${from}${name ? ` (${name})` : ''}\n` +
            `Today is ${new Date().toUTCString()}.`,
        },
      ],
    });
    return parseEmailDraft(result.text, s.name);
  }

  /** The first connected mailbox that may send, or null. */
  private async sendingAccount(userId: string): Promise<{ id: string; email: string } | null> {
    const { data } = await this.supabase.admin
      .from('gmail_accounts')
      .select('id, email, scopes')
      .eq('user_id', userId)
      .order('created_at');
    const rows = (data ?? []) as { id: string; email: string; scopes: string | null }[];
    const ok = rows.find((r) => (r.scopes ?? '').split(/\s+/).includes(GMAIL_SEND_SCOPE));
    return ok ? { id: ok.id, email: ok.email } : null;
  }

  // ---- failure / staleness ----------------------------------------------

  private async notifyFailure(s: DueSchedule, detail: string): Promise<void> {
    if (s.action_type === 'notify') return; // a reminder that failed cannot remind about itself
    await this.push
      .send(s.user_id, {
        title: `Scheduled ${s.action_type === 'email' ? 'email' : 'task'} failed: ${s.name}`,
        body: excerpt(detail),
        kind: 'schedule_result',
        deeplink: '/schedules',
        scheduleId: s.id,
      })
      .catch(() => null);
  }

  private minutesLate(s: DueSchedule): number {
    if (!s.next_run_at) return 0;
    return Math.round((Date.now() - new Date(s.next_run_at).getTime()) / 60_000);
  }

  /**
   * A recurring job whose moment has well and truly passed. One-shots are
   * never stale — missing them entirely is worse than running them late — and
   * neither is a retry already in progress.
   */
  private isStale(s: DueSchedule): boolean {
    if (s.recurrence === 'once' || (s.deferred_count ?? 0) > 0) return false;
    const grace = env().SCHEDULER_STALE_MINUTES;
    if (grace <= 0) return false;
    return this.minutesLate(s) > grace;
  }

  // ---- bookkeeping ------------------------------------------------------

  private nextOccurrence(s: DueSchedule): Date | null {
    return computeNextRun(
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
  }

  /** Move the row on, only if it is still where we found it. True = ours. */
  private async claim(s: DueSchedule, next: Date | null): Promise<boolean> {
    if (!s.next_run_at) return false;
    const { data, error } = await this.supabase.admin
      .from('assistant_schedules')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: next?.toISOString() ?? null,
        enabled: next !== null,
      })
      .eq('id', s.id)
      .eq('next_run_at', s.next_run_at)
      .select('id');
    if (error) {
      this.logger.error(`could not claim schedule ${s.id}: ${error.message}`);
      return false;
    }
    return (data ?? []).length > 0;
  }

  /** Put the row back on the clock for another attempt. */
  private async scheduleRetry(s: DueSchedule, attempt: number, at: Date): Promise<void> {
    const { error } = await this.supabase.admin
      .from('assistant_schedules')
      .update({ next_run_at: at.toISOString(), enabled: true, deferred_count: attempt })
      .eq('id', s.id);
    if (error) this.logger.error(`could not re-arm ${s.id} for a retry: ${error.message}`);
  }

  /** The occurrence is done (any final status): reset the attempt counter, record it. */
  private async finish(s: DueSchedule, attempt: number, outcome: RunOutcome): Promise<void> {
    if ((s.deferred_count ?? 0) > 0) {
      await this.supabase.admin.from('assistant_schedules').update({ deferred_count: 0 }).eq('id', s.id);
    }
    await this.recordRun(s, attempt, outcome);
    await this.audit.record({
      userId: s.user_id,
      actor: 'system',
      action: 'schedule.execute',
      targetType: 'assistant_schedule',
      targetId: s.id,
      detail: { status: outcome.status, action_type: s.action_type, attempt },
    });
  }

  /**
   * Write a row to the run history.
   *
   * The result is checked deliberately: a status the table's check constraint
   * rejects otherwise disappears without a trace, and the run history quietly
   * lies about what happened. Before migration 0022 there is no `attempt` /
   * `result` column and no 'retrying' status, so it falls back to the old
   * shape rather than losing the record. Logs rather than throws.
   */
  private async recordRun(
    s: DueSchedule,
    attempt: number,
    outcome: Pick<RunOutcome, 'status' | 'detail' | 'result'>,
  ): Promise<void> {
    const db = this.supabase.admin;
    const { error } = await db.from('schedule_runs').insert({
      schedule_id: s.id,
      user_id: s.user_id,
      status: outcome.status,
      detail: outcome.detail || null,
      attempt,
      result: outcome.result ?? null,
    });
    if (!error) return;
    const legacy = await db.from('schedule_runs').insert({
      schedule_id: s.id,
      user_id: s.user_id,
      status: outcome.status === 'retrying' ? 'deferred' : outcome.status,
      detail: [outcome.detail, outcome.result].filter(Boolean).join(' — ') || null,
    });
    if (legacy.error) {
      this.logger.error(
        `could not record run for schedule ${s.id} (${outcome.status}): ${legacy.error.message}`,
      );
    }
  }

  // ---- shared actions ---------------------------------------------------

  /** Append messages to the user's main conversation (admin; filtered by user). */
  private async postToChat(
    userId: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<void> {
    const { data: conversation } = await this.supabase.admin
      .from('assistant_conversations')
      .select('id')
      .eq('user_id', userId)
      .eq('is_primary', true)
      .is('archived_at', null)
      .maybeSingle();
    if (!conversation) return;
    const conversationId = (conversation as { id: string }).id;
    for (const m of messages) {
      await this.supabase.admin.from('assistant_messages').insert({
        user_id: userId,
        conversation_id: conversationId,
        role: m.role,
        content: m.content,
      });
    }
    await this.supabase.admin
      .from('assistant_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  private async chatMessage(userId: string, text: string, scheduleId: string) {
    await this.postToChat(userId, [{ role: 'assistant', content: text }]);
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

  // Inactivity nudging moved into the Pulse (the 'silence' signal), so it is
  // scored and budgeted with everything else rather than firing on its own.

  // ---- Phase 16: memory refresh (narrative + episodic) ------------------

  private static readonly NARRATIVE_MAX_AGE_MS = 7 * 24 * 3600_000;
  private static readonly EPISODE_MIN_MESSAGES = 16;

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
    const [msgs, tasks, library] = await Promise.all([
      db
        .from('assistant_messages')
        .select('role, content')
        .eq('user_id', p.user_id)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: false })
        .limit(40),
      db
        .from('tasks')
        .select('title, status, due_at')
        .eq('user_id', p.user_id)
        .eq('status', 'open')
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
    const open = (tasks.data ?? []) as Record<string, unknown>[];
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
              JSON.stringify({ recent_conversation: conversation, open_tasks: open, reading }),
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
   * Episodic memory (COMPANION_VISION §1). When a conversation has moved on
   * enough since the last episode, summarise the new stretch into one line and
   * store it, so the companion can recall "a while back you were deep in the
   * auth refactor" long after the raw messages scroll out of the context
   * window. `assistant.service` injects the most recent episodes.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async episodeRefresh(): Promise<void> {
    if (!env().SCHEDULER_ENABLED) return;
    const db = this.supabase.admin;
    const { data: personas } = await db.from('assistant_persona').select('user_id');
    for (const p of (personas ?? []) as { user_id: string }[]) {
      try {
        await this.refreshEpisode(p.user_id);
      } catch (err) {
        this.logger.warn(
          `episode refresh failed for ${p.user_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async refreshEpisode(userId: string): Promise<void> {
    const db = this.supabase.admin;
    const { data: last } = await db
      .from('memory_episodes')
      .select('period_end')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const since = (last as { period_end: string | null } | null)?.period_end ?? null;

    let q = db
      .from('assistant_messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: true })
      .limit(80);
    if (since) q = q.gt('created_at', since);
    const rows = ((await q).data ?? []) as {
      role: string;
      content: string | null;
      created_at: string;
    }[];
    const withText = rows.filter((r) => r.content);
    if (withText.length < SchedulerService.EPISODE_MIN_MESSAGES) return;

    try {
      const res = await this.llm.generate({
        system:
          'Summarise this stretch of conversation into ONE sentence of episodic ' +
          'memory, third person, past tense — what the person was doing, deciding ' +
          'or working through. No preamble, no advice, just the sentence.',
        messages: [
          {
            role: 'user',
            text: withText.map((m) => `${m.role}: ${m.content}`).join('\n'),
          },
        ],
      });
      const summary = res.text.trim();
      if (!summary) return;
      await db.from('memory_episodes').insert({
        user_id: userId,
        summary,
        message_count: withText.length,
        period_start: withText[0].created_at,
        period_end: withText[withText.length - 1].created_at,
      });
      this.logger.log(`episode recorded for ${userId} (${withText.length} msgs)`);
    } catch (err) {
      this.logger.warn(
        `episode generation failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

interface Persona {
  user_id: string;
  name?: string | null;
  tone?: string | null;
  style_notes?: string | null;
}
