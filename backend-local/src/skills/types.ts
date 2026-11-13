import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { AuthUser } from '../common/auth.guard';

/**
 * What a skill is allowed to do. Enforced by the executor, not by the prompt.
 *
 *   read    — just does it
 *   write   — does it, leaves a receipt
 *   outward — never auto-runs; parks in pending_actions for your approval
 */
export type SideEffect = 'read' | 'write' | 'outward';

export interface SkillContext {
  user: AuthUser;
  /** RLS-scoped client — the skill can only ever touch this user's rows. */
  db: SupabaseClient;
  /** Service role. Only for checks the user must not be able to forge (grants). */
  admin: SupabaseClient;
  now: Date;
  timezone: string;
}

export interface Skill<A = unknown> {
  name: string;
  /** The model picks a skill by this text, so write it for the model. */
  description: string;
  sideEffect: SideEffect;
  /** Gate name in health_access_grants; the skill is hidden without a live grant. */
  requiresGrant?: 'health';
  schema: z.ZodType<A>;
  run(args: A, ctx: SkillContext): Promise<unknown>;
}

/** Helper so each definition keeps its argument type without restating it. */
export function defineSkill<A>(skill: Skill<A>): Skill<A> {
  return skill;
}

export interface InvocationReceipt {
  id: string;
  skill: string;
  side_effect: SideEffect;
  args: Record<string, unknown>;
  status: 'success' | 'failed' | 'needs_approval' | 'denied';
  summary: string;
  error?: string;
}
