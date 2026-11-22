import { Logger } from '@nestjs/common';
import { env } from '../config/env';
import type { LlmMessage, LlmResult, LlmTool } from './llm.service';

/**
 * Google Gemini, in the shape the rest of the agent speaks.
 *
 * Why a second provider at all: Groq's free tier allows 8,000 tokens per
 * minute, which one multi-step turn can exhaust on its own — that is the
 * 413 the agent hit in its first real week. Gemini's free Flash Lite is
 * 250,000 TPM and 500 requests a day, which turns a hard ceiling into a
 * non-issue. What Gemini has instead is congestion: 503 "high demand" is
 * common, and `gemini-flash-latest` answered in 80 seconds on the day this
 * was written. So neither provider is reliable alone, and the point of this
 * file is to make the choice configuration rather than a rewrite.
 *
 * ⚠️ **The thought-signature trap.** Gemini 3 returns a `thoughtSignature`
 * alongside a `functionCall`, and refuses the next request if you send the
 * call back without it:
 *
 *     400 Function call is missing a thought_signature in functionCall parts
 *
 * So a model turn is never reconstructed from `toolCalls` — the provider's
 * own `content` object is kept on `raw` and replayed byte for byte. The
 * `raw` field already existed for exactly this reason on the Groq side; it
 * is load-bearing on both.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
}

interface GeminiContent {
  role?: string;
  parts?: GeminiPart[];
}

interface GeminiResponse {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string; code?: number };
}

export interface GeminiRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  temperature?: number;
  maxTokens?: number;
}

export class GeminiProvider {
  private readonly logger = new Logger(GeminiProvider.name);

  configured(): boolean {
    return Boolean(env().GEMINI_API_KEY);
  }

  /**
   * One attempt. Retries, fallback and the user-facing error live in
   * `LlmService`, which owns them for every provider.
   *
   * Throws an `Error` whose message carries the HTTP status, so the shared
   * transient test (503, 429, 500…) works unchanged.
   */
  async generate(request: GeminiRequest): Promise<LlmResult> {
    const key = env().GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY is not set');

    const body: Record<string, unknown> = {
      contents: toGeminiContents(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 1,
        ...(request.maxTokens ? { maxOutputTokens: request.maxTokens } : {}),
      },
    };

    // Gemma models reject systemInstruction; everything else prefers it.
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }
    if (request.tools?.length) {
      body.tools = [
        {
          functionDeclarations: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const res = await fetch(
      `${API_BASE}/models/${encodeURIComponent(request.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env().LLM_REQUEST_TIMEOUT_MS),
      },
    );

    const parsed = (await res.json().catch(() => ({}))) as GeminiResponse;

    if (!res.ok) {
      // The status goes in the message so isTransient/isTooLarge can read it.
      throw new Error(`${res.status} ${parsed.error?.message ?? 'Gemini request failed'}`);
    }

    const content = parsed.candidates?.[0]?.content;
    const parts = content?.parts ?? [];

    const text = parts
      .map((p) => p.text)
      .filter((t): t is string => typeof t === 'string')
      .join('')
      .trim();

    const toolCalls = parts
      .map((p, index) => ({ call: p.functionCall, index }))
      .filter((p): p is { call: NonNullable<GeminiPart['functionCall']>; index: number } =>
        Boolean(p.call?.name),
      )
      .map(({ call, index }) => ({
        // Gemini has no call id of its own; results are matched by name.
        // The index keeps two calls to the same tool distinguishable on our
        // side, where the executor does key receipts by id.
        id: `${call.name}-${index}`,
        name: call.name as string,
        args: (call.args ?? {}) as Record<string, unknown>,
      }));

    return {
      text,
      toolCalls,
      // The whole content object, thoughtSignature and all. Replayed
      // verbatim on the next turn; see the warning at the top of this file.
      rawParts: content ?? null,
    };
  }

}

/**
 * Our provider-neutral history, in Gemini's shape. Exported because the
 * mapping is where the vendor differences actually live, and it is pure.
 */
export function toGeminiContents(messages: readonly LlmMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      out.push({ role: 'user', parts: [{ text: message.text }] });
      continue;
    }

    if (message.role === 'model') {
      // Replay what the model actually sent, including the signature that
      // Gemini 3 requires back. Only reconstruct when there is no raw —
      // which happens for history loaded from the database, where no tool
      // calls are replayed anyway.
      if (message.raw && typeof message.raw === 'object') {
        out.push(message.raw as GeminiContent);
        continue;
      }
      const parts: GeminiPart[] = [];
      if (message.text) parts.push({ text: message.text });
      for (const call of message.toolCalls ?? []) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      if (parts.length) out.push({ role: 'model', parts });
      continue;
    }

    // Tool results. Gemini matches them to the call by NAME, not by id,
    // and wants an object — our results are strings, so they are wrapped.
    out.push({
      role: 'user',
      parts: message.responses.map((r) => ({
        functionResponse: {
          name: r.name,
          response:
            typeof r.result === 'string'
              ? { result: r.result }
              : ((r.result ?? {}) as Record<string, unknown>),
        },
      })),
    });
  }

  return out;
}
