import type { Capability } from '../capabilities/capability.types';

/**
 * Should this request get an explicit plan?
 *
 * Planning costs one model round trip, so it is not free and must not be
 * automatic. "What's on my calendar today?" does not need an agenda. "Find
 * India's fixtures this month, put them in my calendar and tell me whether I
 * can train today" does — it is three tasks with a dependency, and it is
 * exactly the kind of request that silently half-happens without one.
 *
 * Pure, so the trigger is testable without a model.
 */

/** Words that join one request onto another. */
const CONJUNCTIONS = [
  ' and then ', ' then ', ' and also ', ' also ', ' as well as ', ' after that ',
  ' plus ', ' and ', '; ',
];

/** Imperative-ish verbs: a clause containing one is probably its own task. */
const ACTION_VERBS = [
  'add', 'create', 'book', 'schedule', 'send', 'make', 'put', 'move', 'cancel',
  'delete', 'remind', 'check', 'find', 'look', 'tell', 'save', 'remember',
  'update', 'set', 'plan', 'compare', 'summarise', 'summarize', 'work out',
];

export interface PlanDecision {
  plan: boolean;
  reason: 'multi_clause' | 'multi_category' | 'mutating' | 'single_task' | 'budget';
}

/** How many separate action clauses the sentence seems to contain. */
export function countActionClauses(text: string): number {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  const parts = CONJUNCTIONS.reduce<string[]>(
    (acc, joiner) => acc.flatMap((chunk) => chunk.split(joiner)),
    [lower],
  );
  return parts.filter((part) => ACTION_VERBS.some((verb) => part.includes(verb))).length;
}

export function decidePlan(
  text: string,
  selected: Capability[],
  options: { allowed: boolean },
): PlanDecision {
  if (!options.allowed) return { plan: false, reason: 'budget' };

  if (countActionClauses(text) > 1) return { plan: true, reason: 'multi_clause' };

  const categories = new Set(selected.map((c) => c.category).filter((c) => c !== 'time'));
  if (categories.size > 1) return { plan: true, reason: 'multi_category' };

  // One category, but something in it changes the user's data: worth an
  // agenda, because this is where a half-done turn does damage.
  if (selected.some((c) => c.permission !== 'read')) return { plan: true, reason: 'mutating' };

  return { plan: false, reason: 'single_task' };
}
