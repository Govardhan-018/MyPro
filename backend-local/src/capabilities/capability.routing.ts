import type { Capability } from './capability.types';

/**
 * Capability selection — pure, free, and deterministic.
 *
 * Today's loop offers all 28 skills on every call. That is ~4k tokens of tool
 * schema per model round trip, up to six round trips a turn, and it gets worse
 * with every skill added. This narrows the list *before* the model is asked
 * anything, with no extra model call: a keyword pass over the request, then
 * the dependency closure of whatever matched.
 *
 * Being wrong here must never make a capability unreachable, so:
 *   - `always: true` capabilities are always offered,
 *   - a request that matches little is reported `ambiguous`, and the caller
 *     widens the set rather than guessing (today's behaviour, unchanged),
 *   - the model router (`agent/intent-router.service.ts`) only runs when this
 *     pass is ambiguous, so the cheap path is also the common path.
 */

export interface Selection {
  /** Capability names to offer, strongest first. */
  selected: string[];
  /** True when the keyword pass found too little to trust. */
  ambiguous: boolean;
  /** Per-capability score, for the plan record and for debugging routing. */
  scores: Record<string, number>;
}

export interface SelectionOptions {
  /** Hard cap on how many capabilities may be offered. */
  limit: number;
  /** Below this many confident matches the request is treated as ambiguous. */
  minConfident?: number;
}

const PHRASE_WEIGHT = 2;
const WORD_WEIGHT = 1;
const DEPENDENCY_FLOOR = 0.4;
const ALWAYS_SCORE = 1000;

/** Escape a keyword for use inside a RegExp. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One capability's keyword score against the request text. */
export function scoreCapability(text: string, capability: Capability): number {
  const haystack = ` ${text.toLowerCase()} `;
  let score = 0;
  for (const raw of capability.keywords) {
    const keyword = raw.toLowerCase().trim();
    if (!keyword) continue;
    if (keyword.includes(' ')) {
      if (haystack.includes(keyword)) score += PHRASE_WEIGHT;
    } else if (new RegExp(`\\b${escape(keyword)}\\b`).test(haystack)) {
      score += WORD_WEIGHT;
    }
  }
  return score;
}

/**
 * Pick the capabilities a request plausibly needs.
 *
 * `capabilities` must already be filtered to what this user may use — grants
 * are a security decision and are not re-litigated here.
 */
export function selectCapabilities(
  text: string,
  capabilities: Capability[],
  options: SelectionOptions,
): Selection {
  const byName = new Map(capabilities.map((c) => [c.name, c]));
  const scores: Record<string, number> = {};
  let confident = 0;

  for (const capability of capabilities) {
    if (!capability.enabled) continue;
    if (capability.always) {
      scores[capability.name] = ALWAYS_SCORE;
      continue;
    }
    const score = scoreCapability(text, capability);
    if (score > 0) {
      scores[capability.name] = score;
      confident += 1;
    }
  }

  // Pull in what the matches usually need first (list before update, and so
  // on) at a floor score, so they rank below anything the request named.
  for (const name of Object.keys(scores)) {
    for (const dep of byName.get(name)?.dependencies ?? []) {
      const depCapability = byName.get(dep);
      if (!depCapability?.enabled) continue;
      scores[dep] = Math.max(scores[dep] ?? 0, DEPENDENCY_FLOOR);
    }
  }

  const ambiguous = confident < (options.minConfident ?? 1);

  // Ambiguous: offer everything, best-guess order. Narrowing a request we did
  // not understand is how a capability becomes unreachable.
  const pool = ambiguous
    ? capabilities.filter((c) => c.enabled).map((c) => c.name)
    : Object.keys(scores);

  const ranked = pool
    .slice()
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b))
    .slice(0, Math.max(1, options.limit));

  return { selected: ranked, ambiguous, scores };
}
