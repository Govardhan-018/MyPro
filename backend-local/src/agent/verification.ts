import type { InvocationReceipt } from '../skills/types';
import type { AgentPlan, StepOutcome, StepStatus } from './plan.types';

/**
 * Verification — pure.
 *
 * The house rule is that the agent never claims an action succeeded without a
 * tool result that says so. Until now that was a sentence in the prompt. This
 * makes it mechanical: every plan step is matched against the receipts the
 * turn actually produced, and the result is handed back to the model *before*
 * it writes its answer, so the answer is written against the record.
 *
 * Receipts are consumed as they match, so two steps on the same capability
 * need two successful invocations — one success cannot vouch for both.
 */

const statusOf = (receipt: InvocationReceipt): StepStatus => {
  switch (receipt.status) {
    case 'success':
      return 'verified';
    case 'needs_approval':
      return 'queued';
    default:
      return 'failed';
  }
};

/** Rank for picking the best available receipt for a step. */
const PREFERENCE: Record<StepStatus, number> = {
  verified: 0,
  queued: 1,
  failed: 2,
  not_attempted: 3,
};

export function reconcile(plan: AgentPlan, receipts: readonly InvocationReceipt[]): StepOutcome[] {
  const pool = receipts.map((receipt, index) => ({ receipt, index, taken: false }));

  return plan.steps.map((step) => {
    const candidates = pool
      .filter((entry) => !entry.taken && entry.receipt.skill === step.capability)
      .sort(
        (a, b) =>
          PREFERENCE[statusOf(a.receipt)] - PREFERENCE[statusOf(b.receipt)] || a.index - b.index,
      );

    const match = candidates[0];
    if (!match) return { step, status: 'not_attempted' };

    match.taken = true;
    const status = statusOf(match.receipt);
    return {
      step,
      status,
      invocationId: match.receipt.id,
      detail: status === 'failed' ? (match.receipt.error ?? 'failed') : match.receipt.summary,
    };
  });
}

/** True when every step is accounted for and none failed or was skipped. */
export function fullyDelivered(outcomes: readonly StepOutcome[]): boolean {
  return outcomes.every((o) => o.status === 'verified' || o.status === 'queued');
}

/**
 * The note handed to the model for its final answer. Deliberately blunt: the
 * model is told what it may claim and what it must not.
 */
export function verificationNote(outcomes: readonly StepOutcome[]): string {
  if (!outcomes.length) return '';

  const lines = outcomes.map((o) => {
    const label = `${o.step.id} (${o.step.capability}) — ${o.step.goal}`;
    switch (o.status) {
      case 'verified':
        return `DONE: ${label}${o.detail ? ` — ${o.detail}` : ''}`;
      case 'queued':
        return `WAITING ON THEM (not done): ${label}`;
      case 'failed':
        return `FAILED: ${label} — ${o.detail ?? 'no detail'}`;
      default:
        return `NOT DONE: ${label}`;
    }
  });

  return [
    'WHAT ACTUALLY HAPPENED (from the receipt trail, not from your own account)',
    ...lines,
    '',
    'Write your reply against this list. Claim only what is marked DONE.',
    'Say plainly what FAILED or is NOT DONE, and what you will do about it —',
    'do not quietly drop it, and do not pad the reply to hide it.',
  ].join('\n');
}
