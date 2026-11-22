import type { SideEffect, Skill } from '../skills/types';

/**
 * A capability is a skill plus the metadata the agent needs to *choose* it.
 *
 * The executable registry (`skills/definitions.ts`) stays the single source of
 * truth for what a capability DOES. This layer adds only what routing needs:
 * a category, the vocabulary a request about it would use, and whether it is
 * cheap enough to always offer. Schema and handler therefore cannot drift —
 * there is still exactly one definition of each skill.
 */

export type CapabilityCategory =
  | 'time'
  | 'calendar'
  | 'tasks'
  | 'commitments'
  | 'memory'
  | 'library'
  | 'knowledge'
  | 'health'
  | 'notifications'
  | 'schedules'
  | 'email'
  | 'research'
  | 'news'
  | 'sports'
  | 'weather'
  | 'fitness'
  | 'interests'
  | 'other';

export interface CapabilityMeta {
  /** Must equal the skill's name. */
  name: string;
  /** Bump when the arguments or behaviour change in a way a caller would notice. */
  version: string;
  category: CapabilityCategory;
  /**
   * Words a request needing this capability would plausibly contain. Matched
   * case-insensitively on word boundaries by the router; multi-word phrases
   * are matched as substrings. This is the routing vocabulary, not docs.
   */
  keywords: string[];
  /** Capabilities usually needed before this one. A routing hint, not a lock. */
  dependencies?: string[];
  /** Offered on every request regardless of routing (cheap and near-universal). */
  always?: boolean;
  /** False removes it from routing and from the tool list without deleting code. */
  enabled: boolean;
}

/** Metadata joined to the live skill. What the planner and the loop both read. */
export interface Capability extends CapabilityMeta {
  description: string;
  /** The skill's tier. 'read' is parallel-safe; 'write'/'outward' are not. */
  permission: SideEffect;
  requiresGrant?: 'health';
  input_schema: Record<string, unknown>;
}

export type CapabilitySkill = Skill<any>;
