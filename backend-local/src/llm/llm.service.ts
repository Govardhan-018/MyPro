import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';

/* ------------------------------------------------------------------ */
/* Provider-neutral conversation shape                                  */
/* ------------------------------------------------------------------ */

export interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user'; text: string }
  | { role: 'model'; text?: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; responses: { name: string; result: unknown }[] };

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema; sanitised to Gemini's subset before use. */
  parameters: Record<string, unknown>;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
}

/* ------------------------------------------------------------------ */
/* JSON Schema → Gemini Schema                                          */
/* ------------------------------------------------------------------ */

const TYPE_MAP: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
};

/**
 * Gemini accepts only a small subset of JSON Schema and rejects the request
 * outright on anything else — `minLength`, `additionalProperties`, `$schema`
 * and friends all have to go, and `type` must be the uppercase enum name.
 */
function toGeminiSchema(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const rawType = typeof src.type === 'string' ? src.type : undefined;
  if (rawType && TYPE_MAP[rawType]) out.type = TYPE_MAP[rawType];
  if (typeof src.description === 'string') out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = src.enum.map(String);

  if (rawType === 'object') {
    const props = src.properties as Record<string, unknown> | undefined;
    if (props && Object.keys(props).length) {
      const mapped: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        const child = toGeminiSchema(value);
        if (child) mapped[key] = child;
      }
      if (Object.keys(mapped).length) {
        out.properties = mapped;
        const required = (src.required as string[] | undefined)?.filter((r) => r in mapped);
        if (required?.length) out.required = required;
      }
    }
  }

  if (rawType === 'array') {
    const items = toGeminiSchema(src.items);
    // Gemini requires `items` on every ARRAY.
    out.items = items ?? { type: 'STRING' };
  }

  return Object.keys(out).length ? out : undefined;
}

/** A no-argument tool must omit `parameters` entirely rather than send {}. */
function toolParameters(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  const converted = toGeminiSchema(schema);
  if (!converted || converted.type !== 'OBJECT') return undefined;
  const props = converted.properties as Record<string, unknown> | undefined;
  return props && Object.keys(props).length ? converted : undefined;
}

/* ------------------------------------------------------------------ */

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

/**
 * The only place a model is called. Swapping providers means replacing this
 * file — nothing above it knows about Gemini.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private client: GoogleGenAI | null = null;

  /** Built on first use so the process can start without the key present. */
  private ai(): GoogleGenAI {
    if (!this.client) {
      const apiKey = env().GEMINI_API_KEY;
      if (!apiKey) throw new BadRequestException('This node is not configured to run the AI');
      this.client = new GoogleGenAI({ apiKey });
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

    const contents = params.messages.map((m) => {
      if (m.role === 'user') {
        return { role: 'user', parts: [{ text: m.text }] };
      }
      if (m.role === 'model') {
        const parts: GeminiPart[] = [];
        if (m.text) parts.push({ text: m.text });
        for (const call of m.toolCalls ?? []) {
          parts.push({ functionCall: { name: call.name, args: call.args } });
        }
        // A model turn must never be empty.
        if (!parts.length) parts.push({ text: '' });
        return { role: 'model', parts };
      }
      return {
        role: 'user',
        parts: m.responses.map((r) => ({
          functionResponse: {
            name: r.name,
            // Gemini requires the response to be an object.
            response: { result: r.result ?? null },
          },
        })),
      };
    });

    const declarations = (params.tools ?? []).map((t) => {
      const parameters = toolParameters(t.parameters);
      return {
        name: t.name,
        description: t.description,
        ...(parameters ? { parameters } : {}),
      };
    });

    try {
      const res = await this.ai().models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: params.system,
          temperature: params.temperature ?? 1,
          maxOutputTokens: 2048,
          ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
        },
      });

      const parts = (res.candidates?.[0]?.content?.parts ?? []) as GeminiPart[];
      const text = parts
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      const toolCalls: LlmToolCall[] = parts
        .filter((p) => p.functionCall?.name)
        .map((p) => ({
          name: p.functionCall!.name as string,
          args: (p.functionCall!.args ?? {}) as Record<string, unknown>,
        }));

      return { text, toolCalls };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`model call failed: ${message}`);
      throw new BadRequestException('Assistant is unavailable right now');
    }
  }
}
