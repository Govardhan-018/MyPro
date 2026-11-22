import { z } from 'zod';

/**
 * What a plan is, and the only shape the model is allowed to return one in.
 *
 * A plan is not an execution script — the executor still lets the model call
 * what it needs in the order it needs. A plan is the *agenda*: the list of
 * things this request asked for, each tied to a capability, so that when the
 * turn ends we can check every one of them against the receipt trail and say
 * honestly which happened. Without it, "find the fixtures, add them to my
 * calendar and tell me if I can train" can quietly become "here are the
 * fixtures".
 */

export const planStepSchema = z.object({
  /** Stable within the plan; dependencies refer to it. */
  id: z.string().min(1).max(24),
  /** One short line, in the user's terms, of what this step is for. */
  goal: z.string().min(1).max(200),
  /** A capability name from the offered list. Validated against it. */
  capability: z.string().min(1).max(64),
  /** Steps that must produce their result first. */
  depends_on: z.array(z.string().max(24)).max(8).default([]),
});

export const planSchema = z.object({
  /** One line: what the user actually wants. */
  intent: z.string().min(1).max(300),
  steps: z.array(planStepSchema).min(1).max(10),
  /**
   * Set only when the request cannot be acted on at all without an answer.
   * A plan that asks a question runs nothing.
   */
  clarification: z.string().max(300).nullable().default(null),
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type AgentPlan = z.infer<typeof planSchema>;

/**
 * How a step turned out, judged against receipts — never against the model's
 * own account of itself.
 *
 *   verified      — a successful invocation of that capability exists
 *   queued        — parked in pending_actions, waiting on the user
 *   failed        — invoked and it failed, or was denied
 *   not_attempted — no invocation at all
 */
export type StepStatus = 'verified' | 'queued' | 'failed' | 'not_attempted';

export interface StepOutcome {
  step: PlanStep;
  status: StepStatus;
  /** The receipt that settled it, where there was one. */
  invocationId?: string;
  detail?: string;
}
