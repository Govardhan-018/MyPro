import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none, one } from '../common/crud';

/**
 * Interests — the always-on read/write path for the things the companion
 * watches for you (Phase 20.6).
 *
 * The agent writes these through its own skills ("follow India's cricket
 * team"), but the list has to be readable and editable whether or not the
 * laptop is awake — being able to turn a notification off at the moment it
 * annoys you is what makes it safe to turn on in the first place. Same
 * reasoning as tasks.
 */

const CATEGORY = z.enum(['team', 'player', 'company', 'technology', 'person', 'topic', 'other']);
const NOTIFY = z.enum(['push', 'chat', 'none']);

/**
 * Care more, be interrupted by less. A 5 wants the small stuff; a 1 only
 * wants the thing everyone is talking about. The agent's `follow_interest`
 * skill derives the threshold the same way — change one, change both.
 */
function thresholdFor(level: number): number {
  return Math.max(0.2, Math.min(0.9, 1 - level * 0.12));
}

const createInterest = z.object({
  entity: z.string().min(2).max(120),
  category: CATEGORY.default('topic'),
  aliases: z.array(z.string().min(1).max(80)).max(6).default([]),
  interest_level: z.number().int().min(1).max(5).default(3),
  notify: NOTIFY.default('chat'),
  check_every_hours: z.number().int().min(1).max(720).default(24),
  active: z.boolean().default(true),
});
const patchInterest = createInterest.partial();

@Injectable()
export class InterestsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(user: AuthUser, includePaused?: boolean) {
    let q = this.supabase
      .forUser(user.token)
      .from('interests')
      .select('*')
      .order('interest_level', { ascending: false })
      .order('entity', { ascending: true });
    if (!includePaused) q = q.eq('active', true);
    return many(await q);
  }

  /** What each check turned up — the "why am I being told this?" trail. */
  async findings(user: AuthUser, limit: number) {
    return many(
      await this.supabase
        .forUser(user.token)
        .from('interest_findings')
        .select('id, interest_id, title, url, publisher, published_at, importance, outcome, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 100)),
    );
  }

  async create(user: AuthUser, body: z.infer<typeof createInterest>) {
    return one(
      await this.supabase
        .forUser(user.token)
        .from('interests')
        .upsert(
          {
            ...body,
            user_id: user.id,
            entity: body.entity.trim(),
            importance_threshold: thresholdFor(body.interest_level),
          },
          { onConflict: 'user_id,category,entity' },
        )
        .select('*')
        .single(),
    );
  }

  async update(user: AuthUser, id: string, body: z.infer<typeof patchInterest>) {
    const patch: Record<string, unknown> = { ...body };
    if (body.interest_level != null) {
      patch.importance_threshold = thresholdFor(body.interest_level);
    }
    return one(
      await this.supabase
        .forUser(user.token)
        .from('interests')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single(),
    );
  }

  async remove(user: AuthUser, id: string) {
    return none(
      await this.supabase.forUser(user.token).from('interests').delete().eq('id', id),
    );
  }
}

@Controller('interests')
@UseGuards(AuthGuard)
export class InterestsController {
  constructor(private readonly interests: InterestsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('include_paused') includePaused?: string) {
    return this.interests.list(user, includePaused === 'true');
  }

  @Get('findings')
  findings(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const n = limit ? Number.parseInt(limit, 10) : 20;
    return this.interests.findings(user, Number.isFinite(n) ? n : 20);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.interests.create(user, createInterest.parse(body));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.interests.update(user, id, patchInterest.parse(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.interests.remove(user, id);
  }
}

@Module({
  controllers: [InterestsController],
  providers: [InterestsService],
})
export class InterestsModule {}
