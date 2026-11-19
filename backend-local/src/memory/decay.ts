/**
 * Memory decay (COMPANION_VISION §1). Pure, no I/O.
 *
 * Every semantic fact carries a confidence and a last_used_at. Facts that stop
 * being used should fade out of the prompt rather than sitting there stale
 * forever — "an assistant that can be wrong and updated feels far more alive
 * than one that is confidently stale." A correction (re-writing the fact) bumps
 * last_used_at back to now, so it recovers to full strength.
 */

const DEFAULT_CONFIDENCE = 0.5;
const HALF_LIFE_DAYS = 45;
/** Below this effective strength a fact is dropped from the prompt. */
export const FADE_FLOOR = 0.2;

/**
 * Effective strength now: the stored confidence halved for every
 * `halfLifeDays` since it was last used. A fact used today keeps its full
 * confidence; one untouched for a year is nearly gone.
 */
export function effectiveConfidence(
  confidence: number | null | undefined,
  lastUsedAtMs: number | null | undefined,
  nowMs: number,
  halfLifeDays = HALF_LIFE_DAYS,
): number {
  const base = confidence == null ? DEFAULT_CONFIDENCE : Math.min(1, Math.max(0, confidence));
  if (lastUsedAtMs == null) return base;
  const ageDays = Math.max(0, nowMs - lastUsedAtMs) / 86_400_000;
  return base * Math.pow(0.5, ageDays / halfLifeDays);
}

export function isFaded(eff: number, floor = FADE_FLOOR): boolean {
  return eff < floor;
}

export interface MemoryFact {
  key: string;
  value: string;
  confidence?: number | null;
  last_used_at?: string | null;
}

/**
 * Keep the facts worth injecting: drop the faded ones, sort strongest-first,
 * cap the list. This is what `memoryContext` feeds into the prompt.
 */
export function liveFacts(facts: MemoryFact[], nowMs: number, limit = 20): MemoryFact[] {
  return facts
    .map((f) => ({
      f,
      eff: effectiveConfidence(
        f.confidence ?? null,
        f.last_used_at ? Date.parse(f.last_used_at) : null,
        nowMs,
      ),
    }))
    .filter((x) => !isFaded(x.eff))
    .sort((a, b) => b.eff - a.eff)
    .slice(0, limit)
    .map((x) => x.f);
}
