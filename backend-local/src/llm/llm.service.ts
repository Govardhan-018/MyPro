import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';
import { env } from '../config/env';
import { GeminiProvider } from './gemini.provider';

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

/**
 * Which vendor serves a model, written as a prefix on the model name:
 *
 *     gemini:gemini-flash-lite-latest
 *     groq:openai/gpt-oss-120b
 *
 * No prefix means Groq, so every existing value keeps working untouched.
 * The prefix lives on the model string rather than in its own env var so
 * that each role — chat, routing, planning, the fallback — can sit on a
 * different vendor without four more settings to keep in step.
 */
export type Vendor = 'groq' | 'gemini' | 'cohere' | 'sambanova';

/**
 * Three of the four speak the OpenAI chat-completions dialect, so they share
 * one code path and differ only in where to send it and which key to use.
 * Gemini has its own dialect and its own file.
 */
const OPENAI_COMPATIBLE: Record<string, { baseURL: string; key: () => string | undefined }> = {
  // Groq keeps its SDK — it is proven here and handles the vendor's quirks.
  // The others are called with plain fetch, because the SDK appends Groq's
  // own `/openai/v1` to whatever base URL it is given, which turns another
  // vendor's endpoint into a 404. One wire format, two transports.
  cohere: { baseURL: 'https://api.cohere.ai/compatibility/v1', key: () => env().COHERE_API_KEY },
  sambanova: { baseURL: 'https://api.sambanova.ai/v1', key: () => env().SAMBANOVA_API_KEY },
};

export function parseModel(spec: string): { vendor: Vendor; model: string } {
  const match = /^(groq|gemini|cohere|sambanova):(.+)$/i.exec(spec.trim());
  if (!match) return { vendor: 'groq', model: spec.trim() };
  return { vendor: match[1].toLowerCase() as Vendor, model: match[2].trim() };
}

/**
 * The fallback chain: comma-separated `vendor:model` entries, tried in order
 * after the configured model has exhausted its retries. Four vendors with
 * four different failure modes is only useful if more than one can be named.
 */
export function parseFallbacks(spec: string | undefined): { vendor: Vendor; model: string }[] {
  return (spec ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseModel);
}

/** Hard ceiling on a single model call, so a busy model cannot wedge a request. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Output ceiling when the caller names none. Effort modes override per call. */
const DEFAULT_MAX_TOKENS = 4_096;
/** Free tiers rate-limit and occasionally 5xx; a couple of retries smooths it. */
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1_500;

/**
 * A request bigger than the model's whole per-minute allowance.
 *
 * Groq answers this with a 413 whose body says `rate_limit_exceeded`, which
 * reads as transient and is not: waiting changes nothing, because the
 * request could never have fitted. It was retried three times before anyone
 * noticed. Checked FIRST, ahead of the transient test, precisely because the
 * two overlap.
 */
const isTooLarge = (message: string): boolean =>
  /request too large|reduce your message size|context[_ ]length[_ ]exceeded|\b413\b/i.test(message);

const isTransient = (message: string): boolean =>
  !isTooLarge(message) &&
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
  private readonly gemini = new GeminiProvider();

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
    /**
     * Output ceiling for this call. Effort modes set it; default
     * DEFAULT_MAX_TOKENS.
     *
     * ⚠️ **On a reasoning model this budget includes the reasoning.** The
     * default model (`openai/gpt-oss-120b`) thinks before it answers, and
     * that thinking is spent from the same allowance — so a ceiling that
     * looks generous for the visible answer can truncate it mid-sentence
     * with no error. This cost the planner every single call until it was
     * found: valid JSON, cut off at "Get current date and".
     */
    maxTokens?: number;
    /**
     * How hard to think, where the model supports it. 'low' is the right
     * answer for the classification-shaped calls (routing, planning) — they
     * need a correct shape, not deliberation, and the saved tokens go to the
     * answer instead.
     */
    reasoningEffort?: 'low' | 'medium' | 'high';
    system: string;
    messages: LlmMessage[];
    tools?: LlmTool[];
  }): Promise<LlmResult> {
    const primary = parseModel(params.model || env().ASSISTANT_MODEL);

    try {
      return await this.withRetries(primary, params);
    } catch (err) {
      // Each vendor fails differently — Groq runs out of tokens per minute,
      // Gemini answers 503 under load, Cohere has a monthly cap, SambaNova
      // asks for a card. A chain is only worth having because of that.
      const message = err instanceof Error ? err.message : String(err);
      if (isTooLarge(message)) throw err; // no other model will take it either

      for (const spec of parseFallbacks(env().LLM_FALLBACK_MODEL)) {
        if (spec.vendor === primary.vendor && spec.model === primary.model) continue;
        this.logger.warn(`falling back to ${spec.vendor}:${spec.model}`);
        try {
          return await this.withRetries(spec, params);
        } catch {
          // Try the next one; the primary's error is what gets reported.
        }
      }
      throw err;
    }
  }

  /** The retry loop, shared by every vendor. */
  private async withRetries(
    target: { vendor: Vendor; model: string },
    params: {
      temperature?: number;
      maxTokens?: number;
      reasoningEffort?: 'low' | 'medium' | 'high';
      system: string;
      messages: LlmMessage[];
      tools?: LlmTool[];
    },
  ): Promise<LlmResult> {
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return target.vendor === 'gemini'
          ? await this.gemini.generate({
              model: target.model,
              system: params.system,
              messages: params.messages,
              tools: params.tools,
              temperature: params.temperature,
              maxTokens: params.maxTokens,
            })
          : await this.compatibleGenerate(target.vendor, target.model, params);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (!isTransient(lastError) || attempt === MAX_ATTEMPTS) break;
        this.logger.warn(
          `${target.vendor} busy (attempt ${attempt}/${MAX_ATTEMPTS}), retrying`,
        );
        await sleep(RETRY_BASE_MS * attempt);
      }
    }

    this.logger.error(`${target.vendor} call failed: ${lastError}`);

    if (isTooLarge(lastError)) {
      // Worth its own message: this one is a configuration problem, not
      // weather. Either the effort budgets are too generous for the tier,
      // or something put an unexpectedly large result into the context.
      throw new BadRequestException(
        'That turn was too big for the model to accept. Try Light mode, or a ' +
          'shorter question — and if it keeps happening, the effort budgets in ' +
          'agent/effort.ts are above what this tier allows.',
      );
    }

    throw new BadRequestException(
      isTransient(lastError)
        ? 'The model is busy right now — try again in a moment'
        : 'Assistant is unavailable right now',
    );
  }

  /**
   * The OpenAI-compatible path: Groq, Cohere and SambaNova. The wire format
   * is identical, so the only per-vendor differences are the base URL, the
   * key, and which optional parameters are safe to send.
   */
  private async compatibleGenerate(
    vendor: Vendor,
    model: string,
    params: {
      temperature?: number;
      maxTokens?: number;
      reasoningEffort?: 'low' | 'medium' | 'high';
      system: string;
      messages: LlmMessage[];
      tools?: LlmTool[];
    },
  ): Promise<LlmResult> {
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

    return this.attempt(
      vendor,
      model,
      messages,
      tools,
      params.temperature,
      params.maxTokens,
      // Only Groq takes this. Cohere and SambaNova reject unknown fields,
      // and an unrecognised parameter is a 400, not a silent no-op.
      vendor === 'groq' ? params.reasoningEffort : undefined,
    );
  }

  private async attempt(
    vendor: Vendor,
    model: string,
    messages: ChatMessage[],
    tools: { type: 'function'; function: Record<string, unknown> }[],
    temperature?: number,
    maxTokens?: number,
    reasoningEffort?: 'low' | 'medium' | 'high',
  ): Promise<LlmResult> {
    const body = {
      model,
      messages,
      temperature: temperature ?? 1,
      max_tokens: maxTokens && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS,
      // Groq accepts this on its reasoning models. The others reject
      // unknown fields outright, so it is filtered out before here.
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
    };

    const res =
      vendor === 'groq'
        ? await this.groq().chat.completions.create(
            body as unknown as Parameters<Groq['chat']['completions']['create']>[0],
          )
        : await this.compatibleFetch(vendor, body);

    const message = (res as { choices?: { message?: ChatMessage }[] }).choices?.[0]?.message as
      | {
          content?: string | null;
          tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[];
        }
      | undefined;
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

  /**
   * An OpenAI-compatible vendor that is not Groq. Plain fetch, because the
   * SDK's base URL handling is Groq-shaped (see OPENAI_COMPATIBLE above).
   *
   * The HTTP status goes into the thrown message so the shared transient
   * and too-large tests read it the same way they read the SDK's errors.
   */
  private async compatibleFetch(vendor: Vendor, body: unknown): Promise<unknown> {
    const config = OPENAI_COMPATIBLE[vendor];
    const apiKey = config?.key();
    if (!config || !apiKey) {
      throw new BadRequestException(`No API key configured for ${vendor}`);
    }

    const res = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env().LLM_REQUEST_TIMEOUT_MS),
    });

    const parsed = (await res.json().catch(() => ({}))) as {
      error?: { message?: string } | string;
    };
    if (!res.ok) {
      const detail =
        typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? 'request failed');
      throw new Error(`${res.status} ${detail}`);
    }
    return parsed;
  }
}
