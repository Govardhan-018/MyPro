import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { AuthUser } from '../common/auth.guard';
import type { ResearchService } from '../research/research.service';
import type { StravaClientService } from '../fitness/strava-client.service';
import type { EffortBudget } from '../agent/effort';

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
  /**
   * The internet, behind the provider chains (Phase 20). Present whenever the
   * agent is running normally; a skill must still handle `undefined` so it
   * degrades to a clear refusal rather than a crash.
   */
  research?: ResearchService;
  /**
   * Training history, read through render (Phase 20.5). Absent on a node
   * with no RENDER_API_URL, so a skill must degrade to a clear refusal.
   */
  fitness?: StravaClientService;
  /**
   * Mail freshness: asks render to sync the user's Gmail before an email
   * skill reads `email_messages`. Absent when the node cannot reach render.
   */
  mail?: { refresh(userId: string): Promise<{ ok: boolean; note?: string }> };
  /**
   * The user's own message this turn. Skills that may act without a further
   * approval (scheduling an email that sends itself) read consent from this —
   * never from anything the model wrote or read.
   */
  userMessage?: string;
  /**
   * This turn's effort budget. Research skills read `searchResults` and
   * `fetchPages` from it so breadth follows the user's mode rather than
   * whatever the model asked for.
   */
  budget?: EffortBudget;
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
