import { describe, it, expect } from 'vitest';
import {
  fullyDelivered,
  reconcile,
  verificationNote,
} from '../src/agent/verification';
import type { AgentPlan } from '../src/agent/plan.types';
import type { InvocationReceipt } from '../src/skills/types';

/**
 * Phase 19 — verification.
 *
 * The milestone is a turn that does several things and then reports honestly
 * on all of them. This is the mechanism that makes the report honest: plan
 * steps are settled against receipts, never against what the model says it
 * did. Every case here is a way a turn can half-happen.
 */

const plan = (...capabilities: string[]): AgentPlan => ({
  intent: 'do the things',
  clarification: null,
  steps: capabilities.map((capability, i) => ({
    id: `s${i + 1}`,
    goal: `step ${i + 1}`,
    capability,
    depends_on: i ? [`s${i}`] : [],
  })),
});

const receipt = (
  skill: string,
  status: InvocationReceipt['status'] = 'success',
  over: Partial<InvocationReceipt> = {},
): InvocationReceipt => ({
  id: `inv-${skill}-${status}`,
  skill,
  side_effect: 'write',
  args: {},
  status,
  summary: `${skill} ok`,
  ...over,
});

describe('reconcile', () => {
  it('marks a step verified when a successful invocation exists', () => {
    const outcomes = reconcile(plan('list_events'), [receipt('list_events')]);
    expect(outcomes[0].status).toBe('verified');
    expect(outcomes[0].invocationId).toBe('inv-list_events-success');
  });

  it('marks a step not_attempted when nothing ran — the half-done turn', () => {
    const outcomes = reconcile(plan('list_events', 'create_event'), [receipt('list_events')]);
    expect(outcomes.map((o) => o.status)).toEqual(['verified', 'not_attempted']);
  });

  it('reports a failure as failed, carrying the error', () => {
    const outcomes = reconcile(plan('create_event'), [
      receipt('create_event', 'failed', { error: 'bad date' }),
    ]);
    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].detail).toBe('bad date');
  });

  it('treats an outward action as queued, not done', () => {
    const outcomes = reconcile(plan('send_email'), [receipt('send_email', 'needs_approval')]);
    expect(outcomes[0].status).toBe('queued');
  });

  it('treats a denied capability as failed', () => {
    const outcomes = reconcile(plan('list_health_records'), [
      receipt('list_health_records', 'denied', { error: 'no grant' }),
    ]);
    expect(outcomes[0].status).toBe('failed');
  });

  it('consumes receipts: one success cannot vouch for two steps', () => {
    const outcomes = reconcile(plan('create_event', 'create_event'), [receipt('create_event')]);
    expect(outcomes.map((o) => o.status)).toEqual(['verified', 'not_attempted']);
  });

  it('prefers a success over a failure of the same capability (a retry)', () => {
    const outcomes = reconcile(plan('create_event'), [
      receipt('create_event', 'failed', { id: 'first', error: 'transient' }),
      receipt('create_event', 'success', { id: 'second' }),
    ]);
    expect(outcomes[0].status).toBe('verified');
    expect(outcomes[0].invocationId).toBe('second');
  });

  it('ignores receipts from capabilities the plan never mentioned', () => {
    const outcomes = reconcile(plan('list_events'), [
      receipt('search_emails'),
      receipt('list_events'),
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('verified');
  });
});

describe('fullyDelivered', () => {
  it('counts verified and queued as delivered', () => {
    const outcomes = reconcile(plan('list_events', 'send_email'), [
      receipt('list_events'),
      receipt('send_email', 'needs_approval'),
    ]);
    expect(fullyDelivered(outcomes)).toBe(true);
  });

  it('is false when anything failed or never ran', () => {
    expect(fullyDelivered(reconcile(plan('list_events', 'create_event'), []))).toBe(false);
  });

  it('is true for an empty plan — nothing was promised', () => {
    expect(fullyDelivered([])).toBe(true);
  });
});

describe('verificationNote', () => {
  it('says what is done, waiting, failed and not done', () => {
    const outcomes = reconcile(plan('list_events', 'create_event', 'send_email'), [
      receipt('list_events'),
      receipt('create_event', 'failed', { error: 'clash' }),
      receipt('send_email', 'needs_approval'),
    ]);
    const note = verificationNote(outcomes);

    expect(note).toContain('DONE: s1');
    expect(note).toContain('FAILED: s2');
    expect(note).toContain('clash');
    expect(note).toContain('WAITING ON THEM');
    expect(note).toContain('Claim only what is marked DONE.');
  });

  it('is empty with nothing to report, so no tokens are spent on it', () => {
    expect(verificationNote([])).toBe('');
  });
});
