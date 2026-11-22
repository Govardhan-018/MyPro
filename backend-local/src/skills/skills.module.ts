import {
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
  to: z.string().email(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
});

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
      .select('id, skill, args, summary, state, created_at, expires_at')
      .eq('state', 'pending')
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  @Post('pending/:id/reject')
  async reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.supabase
      .forUser(user.token)
      .from('pending_actions')
      .update({ state: 'rejected', resolved_at: new Date().toISOString() })
      .eq('id', id);
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
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const db = this.supabase.forUser(user.token);

    const { data, error } = await db
      .from('pending_actions')
      .select('id, skill, args, state')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('That action no longer exists.');

    const pending = data as PendingRow;
    if (pending.state !== 'pending') {
      return { ok: false, executed: false, reason: `Already ${pending.state}.` };
    }

    await db
      .from('pending_actions')
      .update({ state: 'approved', resolved_at: new Date().toISOString() })
      .eq('id', id);

    if (pending.skill !== 'send_email') {
      // Every other outward skill records the decision and waits for its
      // integration. Say so plainly rather than reporting a phantom success.
      return {
        ok: true,
        executed: false,
        reason: `Approved. "${pending.skill}" has no live integration yet, so nothing was sent.`,
      };
    }

    const parsed = sendEmailArgs.safeParse(pending.args ?? {});
    if (!parsed.success) {
      const reason = 'That email is missing a valid recipient, subject or body.';
      await this.noteOutcome(db, id, reason);
      return { ok: false, executed: false, reason };
    }

    const result = await this.mail.send({
      userId: user.id,
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body,
    });

    if (!result.ok) {
      await this.noteOutcome(db, id, result.reason);
      await this.audit.record({
        userId: user.id,
        actor: 'user',
        action: 'email.send.failed',
        targetType: 'pending_action',
        targetId: id,
        detail: { to: parsed.data.to, reason: result.reason },
      });
      return { ok: false, executed: false, reason: result.reason };
    }

    await this.noteOutcome(db, id, `Sent from ${result.from || 'your mailbox'}.`);
    return { ok: true, executed: true, reason: `Sent to ${parsed.data.to}.` };
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
