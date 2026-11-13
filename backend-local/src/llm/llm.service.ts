import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';
import { env } from '../config/env';

/* ------------------------------------------------------------------ */
/* Provider-neutral conversation shape                                  */
/* ------------------------------------------------------------------ */

export interface LlmToolCall {
  /** Provider id; must be echoed back on the matching tool result. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user'; text: string }
  | {
      role: 'model';
      text?: string;
      toolCalls?: LlmToolCall[];
      /** Provider's original assistant message, replayed verbatim when present. */
      raw?: unknown;
    }
  | { role: 'tool'; responses: { id: string; name: string; result: unknown }[] };

export interface LlmTool {
  name: string;
  description: string;
  /** Standard JSON Schema — Groq takes it as-is. */
  parameters: Record<string, unknown>;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  /** Pass back as `raw` on the model turn so history replays exactly. */
  rawParts: unknown;
}

/** Hard ceiling on a single model call, so a busy model cannot wedge a request. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Free tiers rate-limit and occasionally 5xx; a couple of retries smooths it. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_500;

const isTransient = (message: string): boolean =>
  /\b(408|429|500|502|503|504)\b|rate.?limit|timeout|ECONNRESET|overloaded/i.test(message);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;

/**
 * The only file that knows which model vendor is in use. Groq speaks the
 * OpenAI chat-completions dialect, so tools are plain JSON Schema and tool
 * results are matched by `tool_call_id`.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private client: Groq | null = null;

  /** Built on first use so the process can start without the key present. */
  private groq(): Groq {
    if (!this.client) {
      const apiKey = env().GROQ_API_KEY;
      if (!apiKey) throw new BadRequestException('This node is not configured to run the AI');
      this.client = new Groq({ apiKey, timeout: REQUEST_TIMEOUT_MS });
    }
    return this.client;
  }

  async generate(params: {
    model?: string;
    temperature?: number;
    system: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
  }): Promise<LlmResult> {
    const model = params.model || env().ASSISTANT_MODEL;

    const messages: ChatMessage[] = [{ role: 'system', content: params.system }];
    for (const m of params.messages) {
      if (m.role === 'user') {
        messages.push({ role: 'user', content: m.text });
        continue;
      }
      if (m.role === 'model') {
        if (m.raw) {
          messages.push(m.raw as ChatMessage);
          continue;
        }
        messages.push({
          role: 'assistant',
          content: m.text ?? '',
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
        });
        continue;
      }
      // Each tool result is its own message, keyed to the call it answers.
      for (const r of m.responses) {
        messages.push({
          role: 'tool',
          tool_call_id: r.id,
          content: typeof r.result === 'string' ? r.result : JSON.stringify(r.result ?? null),
        });
      }
    }

    const tools = (params.tools ?? []).map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await this.attempt(model, messages, tools, params.temperature);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!isTransient(lastError) || attempt === MAX_ATTEMPTS) break;
        this.logger.warn(`model busy (attempt ${attempt}/${MAX_ATTEMPTS}), retrying`);
        await sleep(RETRY_BASE_MS * attempt);
      }
    }

    this.logger.error(`model call failed: ${lastError}`);
    throw new BadRequestException(
      isTransient(lastError)
        ? 'The model is busy right now — try again in a moment'
        : 'Assistant is unavailable right now',
    );
  }

  private async attempt(
    model: string,
    messages: ChatMessage[],
    tools: { type: 'function'; function: Record<string, unknown> }[],
    temperature?: number,
  ): Promise<LlmResult> {
    const res = await this.groq().chat.completions.create({
      model,
      messages,
      temperature: temperature ?? 1,
      max_tokens: 4096,
      ...(tools.length
        ? { tools: tools as unknown as Groq.Chat.Completions.ChatCompletionTool[], tool_choice: 'auto' as const }
        : {}),
    });

    const message = res.choices?.[0]?.message;
    const text = (message?.content ?? '').trim();

    const toolCalls: LlmToolCall[] = (message?.tool_calls ?? []).flatMap((call) => {
      const fn = (call as { function?: { name?: string; arguments?: string } }).function;
      if (!fn?.name) return [];
      let args: Record<string, unknown> = {};
      try {
        // Arguments arrive as a JSON string and can be malformed.
        args = fn.arguments ? (JSON.parse(fn.arguments) as Record<string, unknown>) : {};
      } catch {
        this.logger.warn(`tool ${fn.name} sent unparseable arguments; using {}`);
      }
      return [{ id: (call as { id: string }).id, name: fn.name, args }];
    });

    return { text, toolCalls, rawParts: message };
  }
}
