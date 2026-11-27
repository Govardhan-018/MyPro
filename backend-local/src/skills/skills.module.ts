import {
  Body,
  BadRequestException, Controller, Get, Module, Param, Post, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { AuditService } from '../common/audit.service';
import { SupabaseService } from '../common/supabase.service';
import { LocalGmailModule } from '../gmail/gmail.module';
import { ResearchModule } from '../research/research.module';
import { FitnessModule } from '../fitness/fitness.module';
import { RenderMailService } from '../gmail/render-mail.service';
import { SkillsService } from './skills.service';
import { SKILLS } from './definitions';

/** The arguments a parked `send_email` carries. Re-validated before sending. */
const sendEmailArgs = z.object({
  to: z.string().trim().email(),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
});

/** What the approval card may change before sending. */
const approveEdits = z
  .object({
    to: z.string().trim().email().optional(),
    subject: z.string().trim().min(1).max(300).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict();

interface PendingRow {
  id: string;
  skill: string;
  args: Record<string, unknown> | null;
  state: string;
}

/**
 * Lets the UI show what the companion can do, the receipt trail, and the
 * approval queue for outward actions.
 */
@Controller('skills')
@UseGuards(AuthGuard)
export class SkillsController {
  constructor(
    private readonly skills: SkillsService,
    private readonly supabase: SupabaseService,
    private readonly mail: RenderMailService,
    private readonly audit: AuditService,
  ) {}

  /** Capability list — grows automatically as skills are added. */
  @Get()
  list() {
    return SKILLS.map((s) => ({
      name: s.name,
      description: s.description,
      side_effect: s.sideEffect,
      requires_grant: s.requiresGrant ?? null,
    }));
  }

  /** Receipts: what the companion actually did. */
  @Get('invocations')
  async invocations(@CurrentUser() user: AuthUser) {
    const { data } = await this.supabase
      .forUser(user.token)
      .from('skill_invocations')
      .select('id, skill, side_effect, args, status, error, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    return data ?? [];
  }

  /** Outward actions waiting on you. */
  @Get('pending')
  async pending(@CurrentUser() user: AuthUser) {
    const { data } = await this.supabase
      .forUser(user.token)
      .from('pending_actions')
      .select('id, skill, args, summary, state, created_at, expires_at, result')
      .eq('state', 'pending')
      // An expired request cannot be approved; do not offer it.
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  @Post('pending/:id/reject')
  async reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.supabase
      .forUser(user.token)
      .from('pending_actions')
      .update({ state: 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', id)
      // Never discard one that is already being sent.
      .eq('state', 'pending');
    return { ok: true };
  }

  /**
   * Approve and actually do it — Phase 7.6.
   *
   * The read and the state change go through the **user's** client, so RLS
   * decides whether this row is theirs to approve: nothing here trusts the id
   * in the URL. The arguments are re-validated rather than trusted, because
   * they were written by a model into a jsonb column some time ago.
   *
   * The row is marked approved *before* the send and then annotated with the
   * outcome. The alternative — send first, record after — risks a crash
   * between the two leaving a message sent and an action still pending, which
   * the user would approve again.
   */
  @Post('pending/:id/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const db = this.supabase.forUser(user.token);
    // Optional edits made in the approval card (send_email only).
    const edits = approveEdits.safeParse(body ?? {});
    if (!edits.success) {
      throw new BadRequestException('Those edits are not valid: check the address, subject and text.');
    }

    const { data, error } = await db
      .from('pending_actions')
      .select('id, skill, args, state, expires_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('That action no longer exists.');
    const pending = data as PendingRow & { expires_at?: string | null };

    if (pending.state !== 'pending') {
      return { ok: false, executed: false, reason: `Already ${pending.state}.` };
    }
    if (pending.expires_at && Date.parse(pending.expires_at) < Date.now()) {
      await db.from('pending_actions').update({ state: 'expired' }).eq('id', id).eq('state', 'pending');
      return { ok: false, executed: false, reason: 'This request expired before it was approved.' };
    }

    // The edited email is what gets approved and sent — and what the receipt shows.
    const args =
      pending.skill === 'send_email' && Object.keys(edits.data).length
        ? { ...(pending.args ?? {}), ...edits.data }
        : (pending.args ?? {});

    // Claim it: only a request still 'pending' can move to 'approved'. Two
    // taps, two devices or a retry racing the first attempt get "already
    // approved" instead of a second email.
    const claim = await db
      .from('pending_actions')
      .update({ state: 'approved', resolved_at: new Date().toISOString(), args })
      .eq('id', id)
      .eq('state', 'pending')
      .select('id');
    if (claim.error) throw new BadRequestException(claim.error.message);
    if (!(claim.data ?? []).length) {
      return { ok: false, executed: false, reason: 'Already being handled.' };
    }

    if (pending.skill !== 'send_email') {
      // Every other outward skill records the decision and waits for its
      // integration. Say so plainly rather than reporting a phantom success.
      return {
        ok: true,
        executed: false,
        reason: `Approved. "${pending.skill}" has no live integration yet, so nothing was sent.`,
      };
    }

    const parsed = sendEmailArgs.safeParse(args);
    if (!parsed.success) {
      const reason = 'That email is missing a valid recipient, subject or body.';
      await this.reopen(db, id, reason);
      return { ok: false, executed: false, reason };
    }

    const result = await this.mail.send({
      userId: user.id,
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body,
    });

    if (!result.ok) {
      await this.audit.record({
        userId: user.id,
        actor: 'user',
        action: 'email.send.failed',
        targetType: 'pending_action',
        targetId: id,
        detail: { to: parsed.data.to, reason: result.reason },
      });
      if (result.ambiguous) {
        // It may have gone out: never offer a blind resend.
        await this.noteOutcome(db, id, result.reason);
        return { ok: false, executed: false, reason: result.reason };
      }
      // Certainly not sent: put it back in the queue so it can be fixed and retried.
      await this.reopen(db, id, `Not sent: ${result.reason}`);
      return { ok: false, executed: false, retry: true, reason: result.reason };
    }

    await this.noteOutcome(db, id, `Sent from ${result.from || 'your mailbox'} (Gmail id ${result.id}).`);
    return { ok: true, executed: true, reason: `Sent to ${parsed.data.to}.`, id: result.id };
  }

  /** A send that certainly failed goes back to pending, with the reason. */
  private async reopen(db: ReturnType<SupabaseService['forUser']>, id: string, reason: string) {
    await db
      .from('pending_actions')
      .update({ state: 'pending', resolved_at: null, result: reason })
      .eq('id', id);
  }

  /** The outcome belongs on the row, so the receipt trail is honest. */
  private async noteOutcome(
    db: ReturnType<SupabaseService['forUser']>,
    id: string,
    result: string,
  ): Promise<void> {
    await db.from('pending_actions').update({ result }).eq('id', id);
  }
}

@Module({
  imports: [LocalGmailModule, ResearchModule, FitnessModule],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
