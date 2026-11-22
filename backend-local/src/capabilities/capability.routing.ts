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
const SIBLING_FLOOR = 0.3;
const ACTIONABLE_FLOOR = 0.2;
const ALWAYS_SCORE = 1000;

/**
 * Verbs that mean "do something", not "tell me something".
 *
 * Kept deliberately short: these only ever *widen* the offered set, and the
 * cost of a false positive is one extra tool schema.
 */
const ACTION_VERBS = [
  'add', 'put', 'create', 'make', 'book', 'schedule', 'remind', 'reminder',
  'set up', 'save', 'note down', 'log', 'track', 'plan',
];

/**
 * The capabilities that actually create something. Offered whenever the
 * request asks for an action and routing found no way to perform one.
 */
const CREATORS = ['create_event', 'create_task', 'create_schedule', 'remember'];

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

  // Siblings. If the request touches a category at all, offer the rest of
  // that category's verbs: someone asking to read their calendar is one
  // sentence away from asking to change it, and categories are small.
  const matchedCategories = new Set(
    Object.keys(scores)
      .map((name) => byName.get(name)?.category)
      .filter((c): c is Capability['category'] => Boolean(c) && c !== 'time'),
  );
  for (const capability of capabilities) {
    if (!capability.enabled || scores[capability.name] !== undefined) continue;
    if (matchedCategories.has(capability.category)) {
      scores[capability.name] = SIBLING_FLOOR;
    }
  }

  /*
   * The lie guard.
   *
   * A request that asks for something to be *done*, routed to nothing that
   * can do anything, produces the worst failure this system has: the agent
   * reports that it lacks a capability it actually has. That happened for
   * real — "put a reminder ... in calender" never matched `create_event`
   * because the word was misspelled, and the reply was "I can't create
   * calendar reminders, so you'll need to add this manually."
   *
   * No keyword list fixes a typo. What fixes it is noticing the shape of
   * the request: if it asks for an action and nothing offered can act,
   * widen until something can.
   */
  const wantsAction = ACTION_VERBS.some((verb) => ` ${text.toLowerCase()} `.includes(` ${verb}`));
  const canAct = Object.keys(scores).some(
    (name) => (byName.get(name)?.permission ?? 'read') !== 'read',
  );
  if (wantsAction && !canAct) {
    for (const name of CREATORS) {
      const capability = byName.get(name);
      if (capability?.enabled) scores[name] = Math.max(scores[name] ?? 0, ACTIONABLE_FLOOR);
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
