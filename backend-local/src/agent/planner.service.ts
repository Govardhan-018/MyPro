import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { LlmService } from '../llm/llm.service';
import type { Capability } from '../capabilities/capability.types';
import { planSchema, type AgentPlan } from './plan.types';
import type { EffortBudget } from './effort';

/**
 * Generous because the budget is shared with the model's reasoning: at 700
 * the default model spent it all thinking and the JSON arrived truncated.
 * The plan itself is ~300 tokens.
 */
const PLANNER_MAX_TOKENS = 2_500;

const PLANNER_SYSTEM = [
  'You break one request into the smallest set of steps that satisfies it.',
  '',
  'Rules:',
  '- One step per thing the user actually asked for. Do not invent work.',
  '- Every step names exactly one capability from the list given.',
  '- A step that needs another step first lists it in depends_on.',
  '- Looking something up before changing it is its own step (check before you write).',
  '- Prefer 1-4 steps. Never more than the request contains.',
  '- Set clarification ONLY if the request cannot be started at all without an',
  '  answer from the user; then return steps: [] is not allowed, so still give',
  '  your best single step and put the question in clarification.',
  '',
  'Reply with ONLY this JSON, no prose, no code fence:',
  '{"intent":"<one line>","steps":[{"id":"s1","goal":"<short>","capability":"<name>","depends_on":[]}],"clarification":null}',
].join('\n');

/**
 * The planner.
 *
 * It produces the turn's agenda, not an execution script — the executor still
 * lets the model call tools in whatever order it finds necessary. The agenda's
 * job is to survive the turn so that verification can ask, step by step,
 * "did this actually happen?". That is the difference between an assistant
 * that does three things and one that does the first and talks about the rest.
 *
 * Every failure path returns null and the turn proceeds unplanned, exactly as
 * it did before this layer existed.
 */
@Injectable()
export class PlannerService {
  private readonly logger = new Logger(PlannerService.name);

  constructor(private readonly llm: LlmService) {}

  async plan(params: {
    text: string;
    capabilities: Capability[];
    budget: EffortBudget;
    model?: string;
    /** "Right now it is …" plus anything the model needs to read the request. */
    context?: string;
  }): Promise<AgentPlan | null> {
    const catalogue = params.capabilities
      .map((c) => `${c.name} (${c.category}, ${c.permission}): ${c.description.slice(0, 120)}`)
      .join('\n');

    const system = [
      PLANNER_SYSTEM,
      '',
      params.context ? `CONTEXT\n${params.context}` : undefined,
      '',
      `CAPABILITIES\n${catalogue}`,
    ]
      .filter(Boolean)
      .join('\n');

    let text: string;
    try {
      const res = await this.llm.generate({
        model: env().ASSISTANT_PLANNER_MODEL || params.model,
        temperature: 0,
        maxTokens: PLANNER_MAX_TOKENS,
        // A plan needs a correct shape, not deliberation.
        reasoningEffort: 'low',
        system,
        messages: [{ role: 'user', text: params.text }],
      });
      text = res.text;
    } catch (err) {
      this.logger.warn(`planner call failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }

    return this.parse(text, params.capabilities, params.budget);
  }

  /** Extract, validate and sanity-check a plan. Exposed for tests. */
  parse(raw: string, capabilities: Capability[], budget: EffortBudget): AgentPlan | null {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;

    let candidate: unknown;
    try {
      candidate = JSON.parse(match[0]);
    } catch {
      return null;
    }

    const parsed = planSchema.safeParse(candidate);
    if (!parsed.success) {
      this.logger.warn(`plan rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      return null;
    }

    const known = new Set(capabilities.map((c) => c.name));
    const seen = new Set<string>();
    const steps = parsed.data.steps
      // A step naming a capability that was not offered cannot be executed or
      // verified, so it is dropped rather than carried as a phantom promise.
      .filter((step) => known.has(step.capability))
      .filter((step) => (seen.has(step.id) ? false : (seen.add(step.id), true)))
      .slice(0, Math.max(1, Math.min(10, budget.maxToolSteps)))
      .map((step) => ({
        ...step,
        depends_on: step.depends_on.filter((id) => id !== step.id),
      }));

    if (!steps.length) return null;

    // Dependencies that point at dropped steps would never resolve.
    const ids = new Set(steps.map((s) => s.id));
    return {
      intent: parsed.data.intent,
      clarification: parsed.data.clarification,
      steps: steps.map((s) => ({ ...s, depends_on: s.depends_on.filter((id) => ids.has(id)) })),
    };
  }
}
