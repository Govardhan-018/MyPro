import { Injectable, Logger } from '@nestjs/common';
import { LlmService, type LlmMessage, type LlmTool } from '../llm/llm.service';
import { SkillsService } from '../skills/skills.service';
import type { AuthUser } from '../common/auth.guard';
import type { InvocationReceipt, SideEffect } from '../skills/types';
import type { EffortBudget } from './effort';
import { estimateTokens, fitMessages, toolTokens } from './token-budget';
import { blocksNote, buildBlocks, type DisplayBlock, type ToolOutput } from './display-blocks';

export interface ExecutionRequest {
  user: AuthUser;
  model: string;
  temperature: number;
  system: string;
  messages: LlmMessage[];
  conversationId: string;
  timezone: string;
  tools: LlmTool[];
  /** Capability name → tier. Decides what may run in parallel. */
  permissions: ReadonlyMap<string, SideEffect>;
  budget: EffortBudget;
  /** The user's own message this turn (pre-approval is read from it, never from the model). */
  userMessage?: string;
}

export interface ExecutionResult {
  text: string;
  receipts: InvocationReceipt[];
  /** Model round trips taken. */
  steps: number;
  /** True when the step budget ran out with the model still calling tools. */
  exhausted: boolean;
  /** The conversation as executed, so a final pass can be appended to it. */
  history: LlmMessage[];
  /** Renderable cards built from the tool results, not from the prose. */
  blocks: DisplayBlock[];
  /** The system prompt as it ended up, including the "already on screen" note. */
  system: string;
}

/**
 * The execution engine: the tool-calling loop, with two changes from the flat
 * loop it replaces.
 *
 * **Parallelism.** When every tool call in one model step is read-tier, they
 * run together. The moment a `write` or `outward` call is in the batch, the
 * whole batch runs sequentially in the order the model emitted it — a read
 * after a write may be *checking* that write, and reordering it would make
 * verification lie.
 *
 * **Honest exhaustion.** Running out of steps is no longer silent: the final
 * pass is told it ran out, so the reply can say what is still unfinished
 * instead of quietly answering from a partial gather.
 *
 * Skills still never throw into the loop — every failure arrives as a readable
 * error result plus a receipt, which is what verification later reads.
 */
@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly skills: SkillsService,
  ) {}

  async run(request: ExecutionRequest): Promise<ExecutionResult> {
    const { budget } = request;
    const messages: LlmMessage[] = [...request.messages];
    const receipts: InvocationReceipt[] = [];
    const outputs: ToolOutput[] = [];

    const schemaTokens = toolTokens(request.tools);
    // The system prompt grows once tools have run: the model is told what
    // the screen is already showing so it stops retyping it.
    let system = request.system;
    let systemTokens = estimateTokens(system);

    for (let step = 0; step < budget.maxToolSteps; step++) {
      // Nothing counted tokens before this; a single page of extracted
      // article text was enough to put a request over the free tier's
      // per-minute ceiling, which fails as a 413 that no retry can fix.
      const fitted = fitMessages(messages, {
        systemTokens,
        toolTokens: schemaTokens,
        maxInputTokens: budget.maxInputTokens,
      });
      if (fitted.trimmed) {
        this.logger.warn(
          `trimmed the context to fit ~${budget.maxInputTokens} tokens: ${fitted.detail}`,
        );
      }

      const res = await this.llm.generate({
        model: request.model,
        temperature: request.temperature,
        maxTokens: budget.maxOutputTokens,
        system,
        messages: fitted.messages,
        tools: request.tools,
      });

      if (!res.toolCalls.length) {
        return {
          text: res.text,
          receipts,
          steps: step + 1,
          exhausted: false,
          history: messages,
          blocks: buildBlocks(outputs),
          system,
        };
      }

      messages.push({
        role: 'model',
        text: res.text,
        toolCalls: res.toolCalls,
        raw: res.rawParts,
      });

      const calls = res.toolCalls;
      const allReads = calls.every(
        (call) => (request.permissions.get(call.name) ?? 'write') === 'read',
      );

      const results = allReads
        ? await this.parallel(calls, request)
        : await this.sequential(calls, request);

      for (const entry of results) {
        receipts.push(entry.receipt);
        outputs.push({ name: entry.name, content: entry.content });
      }

      // Recomputed each step: the next call is the one that might write the
      // final answer, and by then the cards are known.
      const note = blocksNote(buildBlocks(outputs));
      if (note) {
        system = `${request.system}

${note}`;
        systemTokens = estimateTokens(system);
      }

      messages.push({
        role: 'tool',
        responses: results.map((entry) => ({
          id: entry.id,
          name: entry.name,
          result: entry.content.slice(0, budget.toolResultChars),
        })),
      });
    }

    this.logger.warn(`step budget (${budget.maxToolSteps}) exhausted in ${budget.mode} mode`);
    return {
      text: '',
      receipts,
      steps: budget.maxToolSteps,
      exhausted: true,
      history: messages,
      blocks: buildBlocks(outputs),
      system,
    };
  }

  /**
   * The closing generation: no tools, plus whatever the turn must be honest
   * about (the verification note, and that the budget ran out).
   */
  async finalAnswer(params: {
    model: string;
    temperature: number;
    system: string;
    history: LlmMessage[];
    note?: string;
    budget: EffortBudget;
  }): Promise<string> {
    const messages: LlmMessage[] = [...params.history];
    if (params.note) messages.push({ role: 'user', text: params.note });

    // No tools on this call, so the schemas are not in the budget — but the
    // history that accumulated during the loop still is.
    const fitted = fitMessages(messages, {
      systemTokens: estimateTokens(params.system),
      toolTokens: 0,
      maxInputTokens: params.budget.maxInputTokens,
    });

    const res = await this.llm.generate({
      model: params.model,
      temperature: params.temperature,
      maxTokens: params.budget.maxOutputTokens,
      system: params.system,
      messages: fitted.messages,
    });
    return res.text;
  }

  // ---- call execution --------------------------------------------------

  private async parallel(
    calls: { id: string; name: string; args: Record<string, unknown> }[],
    request: ExecutionRequest,
  ) {
    const out: { id: string; name: string; content: string; receipt: InvocationReceipt }[] = [];
    const width = Math.max(1, request.budget.parallelism);

    for (let i = 0; i < calls.length; i += width) {
      const batch = calls.slice(i, i + width);
      const settled = await Promise.all(batch.map((call) => this.one(call, request)));
      out.push(...settled);
    }
    return out;
  }

  private async sequential(
    calls: { id: string; name: string; args: Record<string, unknown> }[],
    request: ExecutionRequest,
  ) {
    const out: { id: string; name: string; content: string; receipt: InvocationReceipt }[] = [];
    for (const call of calls) out.push(await this.one(call, request));
    return out;
  }

  private async one(
    call: { id: string; name: string; args: Record<string, unknown> },
    request: ExecutionRequest,
  ) {
    const outcome = await this.skills.execute(request.user, call.name, call.args, {
      conversationId: request.conversationId,
      timezone: request.timezone,
      // Research breadth follows the user's effort mode, not the model's whim.
      budget: request.budget,
      userMessage: request.userMessage,
    });
    return {
      id: call.id,
      name: call.name,
      content: outcome.content,
      receipt: outcome.receipt,
    };
  }
}
