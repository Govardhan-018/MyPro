import {
  Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SupabaseService } from '../common/supabase.service';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import { many, none, one } from '../common/crud';

/**
 * Commitments — the always-on read/write path for the open loops the companion
 * tracks (Phase 16.1). The agent on the laptop writes these straight to
 * Supabase through its skills; this module is how the web/app read and edit
 * them whether or not the laptop is awake, exactly like tasks.
 */

const KIND = z.enum(['promise', 'goal', 'decision', 'intention']);
const STATE = z.enum(['open', 'at_risk', 'done', 'slipped', 'abandoned']);
const TERMINAL: ReadonlyArray<z.infer<typeof STATE>> = ['done', 'slipped', 'abandoned'];

/**
 * First derived check-in: roughly halfway to the deadline (COMPANION_VISION
 * §2's "50% elapsed"), never sooner than 30 minutes out so it doesn't fire
 * immediately. No deadline → no auto check-in (the agent can still set one
 * explicitly). Lives on both create and update, so a commitment that gains a
 * due date later still arms the scheduler. `backend-local`'s create skill has
 * the same rule — change one, change both.
 */
function deriveCheckin(dueIso?: string | null): string | undefined {
  if (!dueIso) return undefined;
  const due = new Date(dueIso).getTime();
  const now = Date.now();
  if (Number.isNaN(due) || due <= now) return undefined;
  const halfway = now + (due - now) * 0.5;
  return new Date(Math.max(halfway, now + 30 * 60_000)).toISOString();
}

const createCommitment = z.object({
  title: z.string().min(1).max(300),
  detail: z.string().max(10_000).optional(),
  kind: KIND.default('promise'),
  due_at: z.string().datetime().optional(),
  confidence: z.number().int().min(0).max(3).default(2),
  state: STATE.default('open'),
  next_checkin_at: z.string().datetime().optional(),
  source_message_id: z.string().uuid().optional(),
});
const patchCommitment = createCommitment.partial();

@Injectable()
export class CommitmentsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(user: AuthUser, state?: string) {
    const db = this.supabase.forUser(user.token);
    let q = db
      .from('commitments')
      .select('*')
      .order('due_at', { ascending: true, nullsFirst: false });
    if (state) q = q.eq('state', state);
    return many(await q);
  }

  async create(user: AuthUser, input: z.infer<typeof createCommitment>) {
    const db = this.supabase.forUser(user.token);
    const row: Record<string, unknown> = { ...input, user_id: user.id };
    if (!input.next_checkin_at) {
      const derived = deriveCheckin(input.due_at);
      if (derived) row.next_checkin_at = derived;
    }
    return one(await db.from('commitments').insert(row).select('*').single());
  }

  async get(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return one(await db.from('commitments').select('*').eq('id', id).maybeSingle());
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof patchCommitment>) {
    const db = this.supabase.forUser(user.token);
    const row: Record<string, unknown> = { ...input };
    // Reaching a terminal state resolves the loop; stamp when, if the caller
    // did not. Re-opening (state back to open/at_risk) clears the stamp.
    if (input.state && TERMINAL.includes(input.state)) {
      row.resolved_at = (input as { resolved_at?: string }).resolved_at ?? new Date().toISOString();
    } else if (input.state) {
      row.resolved_at = null;
    }
    // A commitment that gains (or changes) a due date re-arms its check-in,
    // unless the caller set one explicitly in the same patch.
    if (input.due_at && !input.next_checkin_at) {
      const derived = deriveCheckin(input.due_at);
      if (derived) row.next_checkin_at = derived;
    }
    if (Object.keys(row).length) none(await db.from('commitments').update(row).eq('id', id));
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    const db = this.supabase.forUser(user.token);
    return none(await db.from('commitments').delete().eq('id', id));
  }
}

@Controller('commitments')
@UseGuards(AuthGuard)
export class CommitmentsController {
  constructor(private readonly commitments: CommitmentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('state') state?: string) {
    return this.commitments.list(user, state);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.commitments.create(user, createCommitment.parse(body));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.commitments.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.commitments.update(user, id, patchCommitment.parse(body));
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.commitments.remove(user, id);
  }
}

@Module({ controllers: [CommitmentsController], providers: [CommitmentsService] })
export class CommitmentsModule {}
