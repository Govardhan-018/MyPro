import { Injectable, Logger } from '@nestjs/common';
import type { LlmMessage, LlmTool } from '../llm/llm.service';
import type { AuthUser } from '../common/auth.guard';
import type { InvocationReceipt, SideEffect } from '../skills/types';
import { CapabilityRegistry } from '../capabilities/capability.registry';
import type { Capability } from '../capabilities/capability.types';
import { IntentRouterService } from './intent-router.service';
import { PlannerService } from './planner.service';
import { ExecutionService } from './execution.service';
import { PlanStore } from './plan.store';
import { decidePlan } from './plan-trigger';
import { budgetFor, type EffortMode } from './effort';
import { fullyDelivered, reconcile, verificationNote } from './verification';
import type { AgentPlan, StepOutcome } from './plan.types';
import type { DisplayBlock } from './display-blocks';

export interface AgentRun {
  text: string;
  receipts: InvocationReceipt[];
  mode: EffortMode;
  /** Null when the turn did not warrant an agenda. */
  plan: AgentPlan | null;
  outcomes: StepOutcome[];
  /** Capabilities offered to the model this turn. */
  capabilities: string[];
  /** Model round trips spent, planner and router included. */
  modelCalls: number;
  /** Cards built from the tool results, for the app to render. */
  blocks: DisplayBlock[];
}

/**
 * The agent core.
 *
 *   intent → capability selection → plan → execution → verification → answer
 *
 * Each stage is one injected service, and each stage is optional: a request
 * that needs none of them (a short question in Light mode) costs exactly one
 * model call, which is what the flat loop cost before this existed. A request
 * that needs all of them gets an agenda, parallel reads where they are safe,
 * and a final answer written against the receipt trail rather than against
 * the model's recollection of it.
 *
 * Every stage degrades to the one below. Router fails → the wider capability
 * set. Planner fails → no agenda, loop as before. Verification cannot run →
 * the model's own text stands. The turn never fails *because* of this layer.
 */
@Injectable()
export class AgentCoreService {
  private readonly logger = new Logger(AgentCoreService.name);

  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly router: IntentRouterService,
    private readonly planner: PlannerService,
    private readonly execution: ExecutionService,
    private readonly plans: PlanStore,
  ) {}

  async run(params: {
    user: AuthUser;
    /** The new request on its own — what routing and planning read. */
    request: string;
    model: string;
    temperature: number;
    system: string;
    /** Full conversation including the new user turn. */
    messages: LlmMessage[];
    conversationId: string;
    timezone: string;
    mode: EffortMode;
    /** One line of situational context for the planner (time, timezone). */
    context?: string;
  }): Promise<AgentRun> {
    const budget = budgetFor(params.mode);
    let modelCalls = 0;

    /* ---- 1. what is available, 2. what this needs ---- */
    const available = await this.registry.forUser(params.user);
    const route = await this.router.route({
      text: params.request,
      capabilities: available,
      budget,
      model: params.model,
    });
    if (route.viaModel) modelCalls += 1;

    const selected = available.filter((c) => route.capabilities.includes(c.name));
    const tools = this.toolPayload(selected, route.capabilities);
    const permissions = new Map<string, SideEffect>(selected.map((c) => [c.name, c.permission]));

    /* ---- 3. plan, if the request is worth one ---- */
    const decision = decidePlan(params.request, selected, { allowed: budget.plan });
    let plan: AgentPlan | null = null;
    if (decision.plan) {
      plan = await this.planner.plan({
        text: params.request,
        capabilities: selected,
        budget,
        model: params.model,
        context: params.context,
      });
      modelCalls += 1;
    }

    const planId = plan
      ? await this.plans.open({
          user: params.user,
          conversationId: params.conversationId,
          request: params.request,
          plan,
          mode: params.mode,
          routing: {
            capabilities: route.capabilities,
            ambiguous: route.ambiguous,
            viaModel: route.viaModel,
          },
        })
      : null;

    /* ---- 4. execute ---- */
    const system = plan ? `${params.system}\n\n${this.agenda(plan)}` : params.system;
    const run = await this.execution.run({
      user: params.user,
      model: params.model,
      temperature: params.temperature,
      system,
      messages: params.messages,
      conversationId: params.conversationId,
      timezone: params.timezone,
      tools,
      permissions,
      budget,
    });
    modelCalls += run.steps;

    /* ---- 5. verify against the receipts ---- */
    const outcomes = plan && budget.verify ? reconcile(plan, run.receipts) : [];
    const clean = fullyDelivered(outcomes);
    const needsFinalPass = run.exhausted || !run.text.trim() || (outcomes.length > 0 && !clean);

    let text = run.text;
    if (needsFinalPass) {
      const note = [
        outcomes.length ? verificationNote(outcomes) : '',
        run.exhausted
          ? 'You ran out of tool steps for this turn. Answer with what you have and ' +
            'say plainly what is still outstanding — do not imply it is finished.'
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      try {
        text = await this.execution.finalAnswer({
          model: params.model,
          temperature: params.temperature,
          // run.system, not `system`: it carries the "already on screen"
          // note, without which the closing pass retypes every card.
          system: run.system,
          history: run.history,
          note,
          budget,
        });
        modelCalls += 1;
      } catch (err) {
        // The answer is the product. If the closing pass fails, prefer
        // whatever the loop already said over failing the turn.
        this.logger.warn(
          `final pass failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!text.trim()) throw err;
      }
    }

    if (planId) {
      await this.plans.close({
        user: params.user,
        planId,
        outcomes,
        status: !outcomes.length ? 'completed' : clean ? 'completed' : 'partial',
      });
    }

    return {
      text,
      receipts: run.receipts,
      blocks: run.blocks,
      mode: params.mode,
      plan,
      outcomes,
      capabilities: route.capabilities,
      modelCalls,
    };
  }

  // ---- helpers ---------------------------------------------------------

  private toolPayload(selected: Capability[], order: readonly string[]): LlmTool[] {
    return this.registry.toolsFor(selected, order).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    }));
  }

  /** The agenda the executor works through, injected into the system prompt. */
  private agenda(plan: AgentPlan): string {
    const lines = plan.steps.map((step) => {
      const after = step.depends_on.length ? ` [after ${step.depends_on.join(', ')}]` : '';
      return `${step.id}. ${step.goal} — use ${step.capability}${after}`;
    });

    return [
      'THIS TURN’S AGENDA',
      `They are asking: ${plan.intent}`,
      ...lines,
      '',
      'Work through all of it in this turn. Use the tools — do not assume a result.',
      'If a step turns out to be unnecessary or impossible, say so in your reply',
      'rather than leaving it unmentioned.',
      plan.clarification
        ? `One thing is genuinely unclear: ${plan.clarification} — do what you can, then ask.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
