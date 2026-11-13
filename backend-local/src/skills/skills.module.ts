import { Controller, Get, Module, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { SupabaseService } from '../common/supabase.service';
import { SkillsService } from './skills.service';
import { SKILLS } from './definitions';

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
   * Approving records the decision. Execution of the approved action is
   * wired per-skill as each outward integration lands (Gmail send first),
   * so nothing can silently "succeed" before it is really implemented.
   */
  @Post('pending/:id/approve')
  async approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.supabase
      .forUser(user.token)
      .from('pending_actions')
      .update({ state: 'approved', resolved_at: new Date().toISOString() })
      .eq('id', id);
    return { ok: true, executed: false, reason: 'outward execution not wired yet' };
  }
}

@Module({
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
