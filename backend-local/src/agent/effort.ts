/**
 * Effort modes — one dial the user controls, every budget derived from it.
 *
 * Nothing in the agent core reads a magic number: it reads a budget. That is
 * what makes "this question is cheap, that one deserves real work" a setting
 * rather than a rewrite. Light is for a one-line answer, Default is the
 * everyday companion, Deep is "actually go and work it out".
 *
 * Pure on purpose — the whole table is unit-testable and has no Nest, no env
 * and no database in it.
 */

export type EffortMode = 'light' | 'default' | 'deep';

/**
 * These numbers are sized for a free Groq tier: **8,000 tokens per minute**,
 * applied per request as well as per minute. A request over the limit is a
 * 413 that no retry can fix, so every budget here leaves real headroom —
 * the token estimate is approximate and the output allowance is spent from
 * the same pot. Raising them is the first thing to do on a paid tier; it is
 * also the first thing to suspect if 413s come back.
 */

export const EFFORT_MODES: readonly EffortMode[] = ['light', 'default', 'deep'] as const;

export interface EffortBudget {
  mode: EffortMode;
  /** Model round trips the executor may take before it must answer. */
  maxToolSteps: number;
  /** Capability schemas offered per call. The main per-turn token cost. */
  maxCapabilities: number;
  /** Ask the model for an explicit plan first. */
  plan: boolean;
  /** Reconcile the plan against the receipts and say what did not happen. */
  verify: boolean;
  /** How many tool calls may run at once — read-tier only, ever. */
  parallelism: number;
  /** Semantic facts injected into the prompt. */
  memoryFacts: number;
  /** Episodic summaries injected. */
  episodes: number;
  /** Active attention threads injected. */
  threads: number;
  /** Characters of a single tool result the model is shown. */
  toolResultChars: number;
  /**
   * Ceiling on estimated INPUT tokens per model call, enforced by
   * `token-budget.ts`. Groq's free tier allows 8,000 tokens per minute and
   * applies it per request too, so these sit well under it: the estimate is
   * approximate, and the output allowance comes out of the same budget.
   */
  maxInputTokens: number;
  /** Ceiling on model output per call. */
  maxOutputTokens: number;
  /** Research breadth, once the research capabilities land. */
  searchResults: number;
  /** Pages fetched and extracted per research pass. */
  fetchPages: number;
}

const BUDGETS: Readonly<Record<EffortMode, EffortBudget>> = {
  light: {
    mode: 'light',
    maxToolSteps: 3,
    maxCapabilities: 5,
    plan: false,
    verify: false,
    parallelism: 3,
    memoryFacts: 6,
    episodes: 0,
    threads: 2,
    toolResultChars: 2_500,
    maxInputTokens: 3_500,
    maxOutputTokens: 1_024,
    searchResults: 3,
    fetchPages: 0,
  },
  default: {
    mode: 'default',
    maxToolSteps: 6,
    maxCapabilities: 8,
    plan: true,
    verify: true,
    parallelism: 4,
    memoryFacts: 14,
    episodes: 2,
    threads: 4,
    toolResultChars: 4_000,
    maxInputTokens: 5_200,
    maxOutputTokens: 2_048,
    searchResults: 5,
    fetchPages: 2,
  },
  /**
   * Deep is deeper in *steps and sources*, not in window size. On a free
   * 8,000 TPM tier there is no room for a bigger per-call context — so what
   * it buys is twelve tool steps instead of six, more memory, and more
   * sources read, each call still sized to fit.
   */
  deep: {
    mode: 'deep',
    maxToolSteps: 12,
    maxCapabilities: 14,
    plan: true,
    verify: true,
    parallelism: 4,
    memoryFacts: 24,
    episodes: 4,
    threads: 6,
    toolResultChars: 8_000,
    maxInputTokens: 5_600,
    maxOutputTokens: 2_048,
    searchResults: 8,
    fetchPages: 5,
  },
};

export const DEFAULT_EFFORT: EffortMode = 'default';

export function isEffortMode(value: unknown): value is EffortMode {
  return typeof value === 'string' && (EFFORT_MODES as readonly string[]).includes(value);
}

/** The budget for a mode. Anything unrecognised falls back to Default. */
export function budgetFor(mode: unknown): EffortBudget {
  return BUDGETS[isEffortMode(mode) ? mode : DEFAULT_EFFORT];
}

/**
 * Resolve the mode for one turn: what the message asked for, else what the
 * user's settings say, else Default. A per-message override never persists.
 */
export function resolveEffort(perMessage: unknown, stored: unknown): EffortMode {
  if (isEffortMode(perMessage)) return perMessage;
  if (isEffortMode(stored)) return stored;
  return DEFAULT_EFFORT;
}
