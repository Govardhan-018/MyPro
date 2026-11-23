import { describe, it, expect } from 'vitest';
import { selectCapabilities } from '../src/capabilities/capability.routing';
import { CAPABILITY_META } from '../src/capabilities/capability.meta';
import { SKILLS } from '../src/skills/definitions';
import type { Capability } from '../src/capabilities/capability.types';

/**
 * Phase 12.2 — routing evals.
 *
 * 12.2 as specced runs utterances through the *model* router and scores them.
 * That needs a key and costs a live call, so it is a manual pass. This is the
 * half that must never regress silently and can be checked for free: the
 * keyword pass over the REAL vocabulary in `capability.meta.ts`. It is the
 * cheap path and the common one — the model router only runs when this comes
 * back ambiguous — so if a realistic sentence stops reaching the capability it
 * needs, routing has degraded exactly the way the capability layer exists to
 * prevent, and that is what adding skill N+1 tends to do.
 *
 * Each case asserts the needed capability is offered, in the DEFAULT effort
 * budget (8 slots) — the everyday mode, not the generous one.
 */

// Join metadata to each skill's real side-effect tier, as the registry does.
const tier = new Map(SKILLS.map((s) => [s.name, s.sideEffect]));
const CAPABILITIES: Capability[] = Object.values(CAPABILITY_META).map((m) => ({
  ...m,
  description: `the ${m.name} capability`,
  permission: tier.get(m.name) ?? 'read',
  input_schema: {},
}));

const DEFAULT_LIMIT = 8; // budgetFor('default').maxCapabilities

const route = (text: string) =>
  selectCapabilities(text, CAPABILITIES, { limit: DEFAULT_LIMIT, minConfident: 1 });

/** utterance → the capability a correct route must offer */
const CASES: Array<[string, string]> = [
  // calendar
  ['what is on my calendar this week', 'list_events'],
  ['book the dentist for friday and put it in my calendar', 'create_event'],
  ['move my meeting to 4pm', 'update_event'],
  ['cancel my 3pm appointment', 'delete_event'],
  // tasks
  ['add a task to buy milk', 'create_task'],
  ['what is on my to-do list', 'list_tasks'],
  ['mark the report as done', 'update_task'],
  // commitments
  ['what have I promised people', 'list_commitments'],
  ["I promised Anu I'd finish the deck by friday", 'create_commitment'],
  // memory
  ['remember that I prefer mornings for deep work', 'remember'],
  ['forget what I told you about my diet', 'forget'],
  ['I am worried about the house move, keep an eye on it', 'open_thread'],
  // library + knowledge
  ['what books am I reading', 'search_library'],
  ['add this book to my reading list', 'add_library_item'],
  ['I am halfway through the book', 'update_reading_progress'],
  ['what highlights did I save about focus', 'search_knowledge'],
  ['make a note of this idea', 'save_note'],
  // health (routing only — the grant gate is upstream)
  ['show me my health vitals', 'list_health_records'],
  // reaching the user + schedules
  ['ping me when the download finishes', 'send_notification'],
  ['what recurring routines do I have', 'list_schedules'],
  ['brief me every morning at 8', 'create_schedule'],
  ['turn off the daily reminder', 'delete_schedule'],
  // email
  ['check my inbox', 'list_emails'],
  ['find the email from the bank', 'search_emails'],
  ['draft an email to my boss', 'send_email'],
  // the internet
  ['search the web for the best standing desk', 'web_search'],
  ['what is the latest on the election', 'news_search'],
  ['read this page https://example.com/article', 'fetch_page'],
  ['when does india play cricket next', 'sports_fixtures'],
  ['what is the weather in bangalore', 'get_weather'],
  // fitness + interests
  ['how far did I run this week', 'list_activities'],
  ['keep me updated on anthropic', 'follow_interest'],
  ['what are you watching for me', 'list_interests'],
  ['stop following the lakers', 'update_interest'],
];

describe('routing eval — the keyword pass reaches the right capability', () => {
  it.each(CASES)('%s → offers %s', (text, expected) => {
    const result = route(text);
    expect(result.selected, `"${text}" did not offer ${expected}`).toContain(expected);
  });

  it('settles the common cases without needing the model (not ambiguous)', () => {
    // Every realistic case above has at least one confident match, so the
    // free pass is enough and no router model call is spent.
    const ambiguous = CASES.filter(([text]) => route(text).ambiguous).map(([text]) => text);
    expect(ambiguous, 'these fell through to the model router').toEqual([]);
  });

  it('does not force a write onto a pure question', () => {
    const result = route('what is the weather in bangalore');
    expect(result.selected).toContain('get_weather');
    expect(result.selected).not.toContain('create_task');
    expect(result.selected).not.toContain('create_event');
  });

  it('reports ambiguity rather than guessing on a contentless greeting', () => {
    expect(route('hey there').ambiguous).toBe(true);
  });

  it('stays within the default budget of 8 capabilities', () => {
    for (const [text] of CASES) {
      expect(route(text).selected.length, text).toBeLessThanOrEqual(DEFAULT_LIMIT);
    }
  });
});
