import { describe, it, expect } from 'vitest';
import { budgetFor, resolveEffort, EFFORT_MODES, isEffortMode } from '../src/agent/effort';
import { countActionClauses, decidePlan } from '../src/agent/plan-trigger';
import { PlannerService } from '../src/agent/planner.service';
import type { Capability } from '../src/capabilities/capability.types';

/**
 * Phase 19 — the effort dial and the decision to plan.
 *
 * Both are cost controls as much as quality controls: planning costs a model
 * round trip, so it must fire on "do these three things" and not on "what time
 * is it". And the budget table is the only place a number like "6 tool steps"
 * is allowed to live.
 */

const cap = (over: Partial<Capability> & { name: string }): Capability => ({
  version: '1.0.0',
  category: 'other',
  keywords: [],
  enabled: true,
  description: over.name,
  permission: 'read',
  input_schema: {},
  ...over,
});

describe('resolveEffort', () => {
  it('prefers the per-message override', () => {
    expect(resolveEffort('deep', 'light')).toBe('deep');
  });
  it('falls back to the stored preference, then to default', () => {
    expect(resolveEffort(undefined, 'light')).toBe('light');
    expect(resolveEffort(undefined, undefined)).toBe('default');
  });
  it('ignores anything it does not recognise rather than throwing', () => {
    expect(resolveEffort('turbo', 'nonsense')).toBe('default');
    expect(isEffortMode('turbo')).toBe(false);
  });
});

describe('budgetFor', () => {
  it('gives every mode a budget', () => {
    for (const mode of EFFORT_MODES) expect(budgetFor(mode).mode).toBe(mode);
  });

  it('grows monotonically from light to deep', () => {
    const [light, normal, deep] = [budgetFor('light'), budgetFor('default'), budgetFor('deep')];
    for (const key of ['maxToolSteps', 'maxCapabilities', 'memoryFacts', 'maxOutputTokens'] as const) {
      expect(light[key]).toBeLessThan(normal[key]);
      expect(normal[key]).toBeLessThanOrEqual(deep[key]);
    }
  });

  it('keeps Light to one cheap pass: no planning, no verification', () => {
    const light = budgetFor('light');
    expect(light.plan).toBe(false);
    expect(light.verify).toBe(false);
  });

  it('plans and verifies in Default and Deep', () => {
    for (const mode of ['default', 'deep'] as const) {
      expect(budgetFor(mode).plan).toBe(true);
      expect(budgetFor(mode).verify).toBe(true);
    }
  });

  it('falls back to Default for junk', () => {
    expect(budgetFor('wat').mode).toBe('default');
  });
});

describe('countActionClauses', () => {
  it('counts one task as one', () => {
    expect(countActionClauses('check my calendar today')).toBe(1);
  });

  it('counts a plain question as none — there is nothing to sequence', () => {
    // Below the >1 threshold either way, so it reads as a single task.
    expect(countActionClauses('what is on my calendar today')).toBe(0);
  });

  it('counts the milestone request as several', () => {
    expect(
      countActionClauses(
        "find India's cricket matches this month, add them to my calendar and check whether I can work out today",
      ),
    ).toBeGreaterThan(1);
  });

  it('splits on then as well as and', () => {
    expect(countActionClauses('check my email then remind me to reply')).toBe(2);
  });
});

describe('decidePlan', () => {
  const reads = [cap({ name: 'list_events', category: 'calendar' })];
  const writes = [
    cap({ name: 'list_events', category: 'calendar' }),
    cap({ name: 'create_event', category: 'calendar', permission: 'write' }),
  ];

  it('does not plan a single read in one category', () => {
    expect(decidePlan('what is on my calendar', reads, { allowed: true })).toEqual({
      plan: false,
      reason: 'single_task',
    });
  });

  it('plans a multi-clause request', () => {
    expect(
      decidePlan('check my calendar and send an email', reads, { allowed: true }).reason,
    ).toBe('multi_clause');
  });

  it('plans when something will change the user data', () => {
    expect(decidePlan('book the dentist', writes, { allowed: true }).reason).toBe('mutating');
  });

  it('plans when the request spans categories', () => {
    const spread = [
      cap({ name: 'list_events', category: 'calendar' }),
      cap({ name: 'list_emails', category: 'email' }),
    ];
    expect(decidePlan('anything I should know', spread, { allowed: true }).reason).toBe(
      'multi_category',
    );
  });

  it('never plans when the budget forbids it (Light mode)', () => {
    expect(decidePlan('do this and that and the other', writes, { allowed: false })).toEqual({
      plan: false,
      reason: 'budget',
    });
  });

  it('ignores the time category when counting categories', () => {
    const withClock = [
      cap({ name: 'get_now', category: 'time', always: true }),
      cap({ name: 'list_events', category: 'calendar' }),
    ];
    expect(decidePlan('what is on my calendar', withClock, { allowed: true }).plan).toBe(false);
  });
});

describe('PlannerService.parse', () => {
  // `parse` is pure; the model is never reached.
  const planner = new PlannerService(null as never);
  const budget = budgetFor('default');
  const offered = [
    cap({ name: 'list_events', category: 'calendar' }),
    cap({ name: 'create_event', category: 'calendar', permission: 'write' }),
  ];

  const parse = (raw: string) => planner.parse(raw, offered, budget);

  it('accepts a well-formed plan, prose around it and all', () => {
    const result = parse(
      'Sure! {"intent":"book it","steps":[' +
        '{"id":"s1","goal":"check for clashes","capability":"list_events","depends_on":[]},' +
        '{"id":"s2","goal":"book it","capability":"create_event","depends_on":["s1"]}' +
        '],"clarification":null}',
    );
    expect(result?.steps).toHaveLength(2);
    expect(result?.steps[1].depends_on).toEqual(['s1']);
  });

  it('drops a step naming a capability that was never offered', () => {
    const result = parse(
      '{"intent":"x","steps":[{"id":"s1","goal":"g","capability":"launch_rocket","depends_on":[]},' +
        '{"id":"s2","goal":"g","capability":"list_events","depends_on":[]}],"clarification":null}',
    );
    expect(result?.steps.map((s) => s.capability)).toEqual(['list_events']);
  });

  it('returns null when nothing executable survives', () => {
    expect(
      parse('{"intent":"x","steps":[{"id":"s1","goal":"g","capability":"nope","depends_on":[]}]}'),
    ).toBeNull();
  });

  it('prunes dependencies that point at dropped or missing steps', () => {
    const result = parse(
      '{"intent":"x","steps":[{"id":"s2","goal":"g","capability":"create_event","depends_on":["s1","s2"]}]}',
    );
    expect(result?.steps[0].depends_on).toEqual([]);
  });

  it('de-duplicates step ids', () => {
    const result = parse(
      '{"intent":"x","steps":[{"id":"s1","goal":"a","capability":"list_events","depends_on":[]},' +
        '{"id":"s1","goal":"b","capability":"create_event","depends_on":[]}]}',
    );
    expect(result?.steps).toHaveLength(1);
  });

  it('refuses junk rather than guessing', () => {
    expect(parse('I think we should start by checking the calendar.')).toBeNull();
    expect(parse('{"intent":"x"}')).toBeNull();
    expect(parse('{broken')).toBeNull();
  });

  it('never exceeds the mode step budget', () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      goal: 'g',
      capability: 'list_events',
      depends_on: [],
    }));
    const result = planner.parse(
      JSON.stringify({ intent: 'x', steps, clarification: null }),
      offered,
      budgetFor('light'),
    );
    expect(result?.steps.length).toBeLessThanOrEqual(budgetFor('light').maxToolSteps);
  });
});
