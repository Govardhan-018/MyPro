import { Injectable, Logger, Module } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../common/supabase.service';
import { AuditService } from '../common/audit.service';
import { LlmModule } from '../llm/llm.module';
import { LlmService } from '../llm/llm.service';
import { LocalNotificationsModule } from '../notifications/notifications.module';
import { PushService } from '../notifications/push.service';
import {
  score,
  rank,
  gate,
  noveltyFromLastSent,
  type Candidate,
  type SignalType,
} from './scoring';
import { env } from '../config/env';

/**
 * The Pulse (COMPANION_VISION §3) — proactivity with taste.
 *
 * Every half hour it gathers candidate things-worth-saying for each user who
 * left proactivity on, scores each urgency × value × novelty, and sends only
 * the strongest that clear a minimum score, a per-signal cooldown and a daily
 * budget. Everything it evaluated — sent or suppressed and why — is written to
 * `interventions`, so "what did you decide not to tell me today?" has a real
 * answer. Silence is a valid, recorded output.
 *
 * This subsumes the earlier one-off commitment check-in and inactivity nudge:
 * they are now just two signal types among several.
 */

interface Persona {
  user_id: string;
  name?: string | null;
  tone?: string | null;
  style_notes?: string | null;
  inactivity_hours?: number | null;
}

interface RawCandidate extends Candidate {
  cooldownMs: number;
  commitmentId?: string;
}

const MIN_SCORE = 0.15;
const DAILY_BUDGET = 3;
const COOLDOWN: Record<SignalType, number> = {
  commitment: 6 * 3600_000,
  task: 12 * 3600_000,
  email: 6 * 3600_000,
  silence: 24 * 3600_000,
  evening: 20 * 3600_000,
  weekly: 6 * 24 * 3600_000,
};

@Injectable()
export class PulseService {
  private readonly logger = new Logger(PulseService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly push: PushService,
    private readonly llm: LlmService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async pulse(): Promise<void> {
    if (!env().SCHEDULER_ENABLED) return;
    const { data } = await this.supabase.admin
      .from('assistant_persona')
      .select('user_id, name, tone, style_notes, inactivity_hours')
      .eq('proactive_enabled', true);
    for (const p of (data ?? []) as Persona[]) {
      try {
        await this.runForUser(p);
      } catch (err) {
        this.logger.warn(
          `pulse failed for ${p.user_id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async runForUser(p: Persona): Promise<void> {
    const db = this.supabase.admin;
    const now = Date.now();

    const profile = (
      await db.from('profiles').select('timezone').eq('user_id', p.user_id).maybeSingle()
    ).data as { timezone?: string } | null;
    const tz = profile?.timezone || 'UTC';

    const candidates = await this.gather(p, tz, now);
    if (!candidates.length) return;

    // Novelty + cooldown both come from when this signal type last *sent*.
    const lastSent = new Map<SignalType, number | null>();
    for (const type of new Set(candidates.map((c) => c.signalType))) {
      lastSent.set(type, await this.lastSentAt(p.user_id, type));
    }
    for (const c of candidates) {
      c.novelty = noveltyFromLastSent(lastSent.get(c.signalType) ?? null, now);
    }

    let sentToday = await this.sentToday(p.user_id, now);
    for (const c of rank(candidates)) {
      const last = lastSent.get(c.signalType) ?? null;
      const result = gate({
        score: score(c),
        minScore: MIN_SCORE,
        sinceLastOfTypeMs: last == null ? null : now - last,
        cooldownMs: c.cooldownMs,
        sentToday,
        dailyBudget: DAILY_BUDGET,
      });

      if (result.outcome === 'suppressed') {
        await this.record(p.user_id, c, 'suppressed', result.reason);
        continue;
      }

      const message = await this.compose(p, c);
      await this.deliver(p.user_id, message, c.signalType);
      await this.record(p.user_id, c, 'sent');
      await this.afterSend(c, now);
      sentToday += 1;
      if (sentToday >= DAILY_BUDGET) break;
    }
  }

  // ---- signal gathering -------------------------------------------------

  private async gather(p: Persona, tz: string, now: number): Promise<RawCandidate[]> {
    const db = this.supabase.admin;
    const out: RawCandidate[] = [];
    const nowIso = new Date(now).toISOString();

    const commitments = (
      await db
        .from('commitments')
        .select('id, title, detail, due_at, state')
        .eq('user_id', p.user_id)
        .in('state', ['open', 'at_risk'])
        .not('next_checkin_at', 'is', null)
        .lte('next_checkin_at', nowIso)
        .order('next_checkin_at')
        .limit(5)
    ).data as
      | { id: string; title: string; detail: string | null; due_at: string | null; state: string }[]
      | null;
    for (const c of commitments ?? []) {
      const overdue = c.due_at != null && new Date(c.due_at).getTime() < now;
      const soon = c.due_at != null && new Date(c.due_at).getTime() - now < 24 * 3600_000;
      out.push({
        signalType: 'commitment',
        urgency: overdue ? 0.9 : soon ? 0.8 : 0.5,
        value: 0.85,
        novelty: 1,
        cooldownMs: COOLDOWN.commitment,
        commitmentId: c.id,
        payload: { id: c.id, title: c.title, detail: c.detail, due_at: c.due_at, overdue },
      });
    }

    const tasks = (
      await db
        .from('tasks')
        .select('id, title, due_at')
        .eq('user_id', p.user_id)
        .eq('status', 'open')
        .not('due_at', 'is', null)
        .lte('due_at', new Date(now + 24 * 3600_000).toISOString())
        .order('due_at')
        .limit(3)
    ).data as { id: string; title: string; due_at: string | null }[] | null;
    for (const t of tasks ?? []) {
      const overdue = t.due_at != null && new Date(t.due_at).getTime() < now;
      out.push({
        signalType: 'task',
        urgency: overdue ? 0.7 : 0.5,
        value: 0.5,
        novelty: 1,
        cooldownMs: COOLDOWN.task,
        payload: { id: t.id, title: t.title, due_at: t.due_at, overdue },
      });
    }

    const emails = (
      await db
        .from('email_messages')
        .select('subject, from_addr, is_read, email_insights(action_needed, summary)')
        .eq('user_id', p.user_id)
        .eq('is_read', false)
        .order('internal_date', { ascending: false })
        .limit(10)
    ).data as
      | {
          subject: string | null;
          from_addr: string | null;
          email_insights: { action_needed: boolean; summary: string | null } | null;
        }[]
      | null;
    const actionable = (emails ?? []).filter((e) => e.email_insights?.action_needed);
    if (actionable.length) {
      const top = actionable[0];
      out.push({
        signalType: 'email',
        urgency: 0.55,
        value: 0.6,
        novelty: 1,
        cooldownMs: COOLDOWN.email,
        payload: {
          count: actionable.length,
          subject: top.subject,
          from: top.from_addr,
          summary: top.email_insights?.summary,
        },
      });
    }

    const activity = (
      await db
        .from('user_activity')
        .select('last_active_at')
        .eq('user_id', p.user_id)
        .maybeSingle()
    ).data as { last_active_at: string | null } | null;
    if (activity?.last_active_at) {
      const quietH = (now - new Date(activity.last_active_at).getTime()) / 3600_000;
      if (quietH >= (p.inactivity_hours ?? 10)) {
        out.push({
          signalType: 'silence',
          urgency: 0.3,
          value: 0.5,
          novelty: 1,
          cooldownMs: COOLDOWN.silence,
          payload: { quiet_hours: Math.round(quietH) },
        });
      }
    }

    // Rhythm: the evening question and the Sunday letter, in local time.
    const { hour, weekday } = this.localParts(tz);
    if (hour >= 19 && hour < 22) {
      out.push({
        signalType: 'evening',
        urgency: 0.4,
        value: 0.6,
        novelty: 1,
        cooldownMs: COOLDOWN.evening,
        payload: {},
      });
    }
    if (weekday === 'Sun' && hour >= 17 && hour < 21) {
      out.push({
        signalType: 'weekly',
        urgency: 0.5,
        value: 0.85,
        novelty: 1,
        cooldownMs: COOLDOWN.weekly,
        payload: {},
      });
    }

    return out;
  }

  private localParts(tz: string): { hour: number; weekday: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    }).formatToParts(new Date());
    const hour = Number(parts.find((x) => x.type === 'hour')?.value ?? '0') % 24;
    const weekday = parts.find((x) => x.type === 'weekday')?.value ?? 'Mon';
    return { hour, weekday };
  }

  // ---- compose / deliver / record --------------------------------------

  private async compose(p: Persona, c: RawCandidate): Promise<string> {
    const briefs: Record<SignalType, string> = {
      commitment: 'a commitment they made that is due for a check-in',
      task: 'an open task that is due or overdue',
      email: 'an email that looks like it needs a reply',
      silence: 'they have been quiet for a while — a warm, light hello',
      evening: 'an evening close-out and one good, specific question drawn from their day',
      weekly: 'a short Sunday letter: what you noticed this week and one thing worth sitting with',
    };
    try {
      const res = await this.llm.generate({
        system:
          `You are ${p.name ?? 'MyPro'}, a close-friend assistant.` +
          (p.tone ? ` Tone: ${p.tone}.` : '') +
          (p.style_notes ? ` ${p.style_notes}` : '') +
          ' Write ONE short proactive message (1-3 sentences, no greeting fluff, ' +
          'no lists) about ' +
          briefs[c.signalType] +
          '. Be specific and useful; offer a concrete next move where it helps. ' +
          'Only use the facts given.',
        messages: [{ role: 'user', text: `FACTS: ${JSON.stringify(c.payload ?? {})}` }],
      });
      const text = res.text.trim();
      if (text) return text;
    } catch (err) {
      this.logger.warn(
        `pulse compose failed (${err instanceof Error ? err.message : String(err)}) — plain`,
      );
    }
    return this.plain(c);
  }

  private plain(c: RawCandidate): string {
    const title = (c.payload?.title as string) ?? '';
    switch (c.signalType) {
      case 'commitment':
        return c.payload?.overdue
          ? `About "${title}" — it's past due. Want to reschedule it or close it out?`
          : `Checking in on "${title}". How's it going — want me to block time for it?`;
      case 'task':
        return `Heads up: "${title}" is ${c.payload?.overdue ? 'overdue' : 'due soon'}.`;
      case 'email':
        return `You have ${c.payload?.count ?? 1} email(s) that look like they need a reply.`;
      case 'silence':
        return "Hey — it's been a while. How are you doing?";
      case 'evening':
        return 'Winding down — anything you want to note before the day closes?';
      case 'weekly':
        return 'A quiet Sunday note: how did the week land for you?';
    }
  }

  private async deliver(userId: string, text: string, type: SignalType): Promise<void> {
    const db = this.supabase.admin;
    const { data: convo } = await db
      .from('assistant_conversations')
      .select('id')
      .eq('user_id', userId)
      .eq('is_primary', true)
      .is('archived_at', null)
      .maybeSingle();
    if (convo) {
      await db.from('assistant_messages').insert({
        user_id: userId,
        conversation_id: (convo as { id: string }).id,
        role: 'assistant',
        content: text,
      });
    }
    await this.push.send(userId, { title: 'MyPro', body: text, kind: `pulse:${type}`, deeplink: '/assistant' });
  }

  private async afterSend(c: RawCandidate, now: number): Promise<void> {
    if (c.signalType !== 'commitment' || !c.commitmentId) return;
    const dueAt = c.payload?.due_at as string | null | undefined;
    const patch: Record<string, unknown> = {};
    if (c.payload?.overdue) patch.state = 'at_risk';
    const next =
      dueAt && new Date(dueAt).getTime() > now
        ? Math.max(now + (new Date(dueAt).getTime() - now) / 2, now + 6 * 3600_000)
        : now + 24 * 3600_000;
    patch.next_checkin_at = new Date(next).toISOString();
    await this.supabase.admin.from('commitments').update(patch).eq('id', c.commitmentId);
  }

  private async record(
    userId: string,
    c: RawCandidate,
    outcome: 'sent' | 'suppressed',
    reason?: string,
  ): Promise<void> {
    await this.supabase.admin.from('interventions').insert({
      user_id: userId,
      signal_type: c.signalType,
      payload: c.payload ?? {},
      urgency: c.urgency,
      value: c.value,
      novelty: c.novelty,
      score: score(c),
      outcome,
      suppressed_reason: reason ?? null,
      sent_at: outcome === 'sent' ? new Date().toISOString() : null,
    });
    if (outcome === 'sent') {
      await this.audit.record({
        userId,
        actor: 'system',
        action: `pulse.${c.signalType}`,
      });
    }
  }

  private async lastSentAt(userId: string, type: SignalType): Promise<number | null> {
    const { data } = await this.supabase.admin
      .from('interventions')
      .select('sent_at')
      .eq('user_id', userId)
      .eq('signal_type', type)
      .eq('outcome', 'sent')
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const at = (data as { sent_at: string | null } | null)?.sent_at;
    return at ? new Date(at).getTime() : null;
  }

  private async sentToday(userId: string, now: number): Promise<number> {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const { count } = await this.supabase.admin
      .from('interventions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('outcome', 'sent')
      .gte('sent_at', start.toISOString());
    return count ?? 0;
  }
}

@Module({ imports: [LlmModule, LocalNotificationsModule], providers: [PulseService] })
export class PulseModule {}
