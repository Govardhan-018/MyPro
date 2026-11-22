/**
 * The Pulse — scoring and gates (COMPANION_VISION §3). Pure, no I/O, so the
 * logic that decides whether the companion speaks is directly testable.
 *
 * A candidate intervention is scored `urgency × value × novelty`, then run
 * through three gates: a minimum score, a per-signal cooldown, and a per-user
 * daily budget. Anything that doesn't clear the bar is recorded as suppressed,
 * never silently dropped — "silence is a valid, recorded output".
 */

export type SignalType =
  | 'commitment'
  | 'task'
  | 'email'
  | 'silence'
  | 'evening'
  | 'weekly'
  /** Something they asked to be kept updated on actually happened (20.6). */
  | 'interest';

export interface Candidate {
  signalType: SignalType;
  /** Time-sensitivity, 0..1 (meeting in 30 min = 1; "you might enjoy this" = 0.1). */
  urgency: number;
  /** Does saying this change anything they'd do? 0..1. */
  value: number;
  /** 1 when fresh; decays toward 0 the more recently this signal fired. */
  novelty: number;
  payload?: Record<string, unknown>;
}

export type SuppressedReason = 'low_score' | 'cooldown' | 'budget';
export type Outcome = 'sent' | 'suppressed';

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** score = urgency × value × novelty, each clamped to [0,1]. */
export function score(c: Pick<Candidate, 'urgency' | 'value' | 'novelty'>): number {
  return clamp01(c.urgency) * clamp01(c.value) * clamp01(c.novelty);
}

/**
 * Novelty from how long ago the same signal last fired: 1 when it has never
 * fired (or long ago), decaying by half every `halfLifeMs`. The third mention
 * of the same stale task scores near zero on its own.
 */
export function noveltyFromLastSent(
  lastSentAtMs: number | null,
  nowMs: number,
  halfLifeMs = 24 * 3600_000,
): number {
  if (lastSentAtMs == null) return 1;
  const age = Math.max(0, nowMs - lastSentAtMs);
  // Just fired → ~0 (not novel); one half-life later → 0.5; long ago → ~1.
  return clamp01(1 - Math.pow(2, -age / halfLifeMs));
}

export interface GateInput {
  score: number;
  minScore: number;
  /** ms since this signal last fired for this user, or null if never. */
  sinceLastOfTypeMs: number | null;
  cooldownMs: number;
  /** interventions already *sent* to this user today. */
  sentToday: number;
  dailyBudget: number;
}

export interface GateResult {
  outcome: Outcome;
  reason?: SuppressedReason;
}

/**
 * The three gates, in the order that gives the most useful suppressed_reason:
 * too weak to bother → still cooling down → out of budget for the day.
 */
export function gate(input: GateInput): GateResult {
  if (input.score < input.minScore) return { outcome: 'suppressed', reason: 'low_score' };
  if (input.sinceLastOfTypeMs != null && input.sinceLastOfTypeMs < input.cooldownMs) {
    return { outcome: 'suppressed', reason: 'cooldown' };
  }
  if (input.sentToday >= input.dailyBudget) return { outcome: 'suppressed', reason: 'budget' };
  return { outcome: 'sent' };
}

/** Rank candidates strongest-first so the daily budget is spent on what matters. */
export function rank<T extends Candidate>(candidates: T[]): T[] {
  return [...candidates].sort((a, b) => score(b) - score(a));
}
