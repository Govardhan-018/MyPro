import { describe, it, expect } from 'vitest';
import { parseModel } from '../src/llm/llm.service';
import { toGeminiContents } from '../src/llm/gemini.provider';
import type { LlmMessage } from '../src/llm/llm.service';

/**
 * A second model vendor.
 *
 * Groq and Gemini fail in opposite directions — Groq's free tier is 8,000
 * tokens a minute, which one multi-step turn can exhaust, while Gemini Flash
 * Lite is 250,000 but answers 503 "high demand" under load. Having both is
 * what makes either usable, and the whole difference between them lives in
 * two places: which vendor a model name belongs to, and how a conversation
 * is shaped. Both are tested here; the network is not.
 */

describe('parseModel', () => {
  it('defaults to Groq, so every existing config keeps working', () => {
    expect(parseModel('openai/gpt-oss-120b')).toEqual({
      vendor: 'groq',
      model: 'openai/gpt-oss-120b',
    });
  });

  it('reads an explicit vendor prefix', () => {
    expect(parseModel('gemini:gemini-flash-lite-latest')).toEqual({
      vendor: 'gemini',
      model: 'gemini-flash-lite-latest',
    });
    expect(parseModel('groq:llama-3.3-70b')).toEqual({ vendor: 'groq', model: 'llama-3.3-70b' });
  });

  it('does not mistake a slash in a model name for a prefix', () => {
    // Groq model ids contain slashes; only a known vendor word counts.
    expect(parseModel('openai/gpt-oss-120b').vendor).toBe('groq');
    expect(parseModel('meta-llama/llama-4').model).toBe('meta-llama/llama-4');
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(parseModel('  GEMINI:gemini-flash-lite-latest  ')).toEqual({
      vendor: 'gemini',
      model: 'gemini-flash-lite-latest',
    });
  });
});

describe('toGeminiContents', () => {
  it('maps a user turn', () => {
    expect(toGeminiContents([{ role: 'user', text: 'hello' }])).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
    ]);
  });

  /**
   * The trap this whole adapter is shaped around. Gemini 3 returns a
   * `thoughtSignature` beside a `functionCall` and rejects the next request
   * if the call comes back without it:
   *
   *   400 Function call is missing a thought_signature in functionCall parts
   *
   * So a model turn carrying `raw` is replayed byte for byte, never rebuilt.
   */
  it('replays a model turn verbatim when raw is present', () => {
    const raw = {
      role: 'model',
      parts: [
        { functionCall: { name: 'list_events', args: { from: 'x' } }, thoughtSignature: 'sig-abc' },
      ],
    };
    const messages: LlmMessage[] = [
      { role: 'model', text: '', toolCalls: [{ id: 'list_events-0', name: 'list_events', args: {} }], raw },
    ];

    const [content] = toGeminiContents(messages);
    expect(content).toBe(raw);
    expect(JSON.stringify(content)).toContain('sig-abc');
  });

  it('reconstructs a model turn only when there is no raw', () => {
    const [content] = toGeminiContents([
      { role: 'model', text: 'thinking', toolCalls: [{ id: 'a-0', name: 'a', args: { x: 1 } }] },
    ]);
    expect(content.role).toBe('model');
    expect(content.parts).toEqual([{ text: 'thinking' }, { functionCall: { name: 'a', args: { x: 1 } } }]);
  });

  it('skips an empty model turn rather than sending empty parts', () => {
    expect(toGeminiContents([{ role: 'model', text: '' }])).toEqual([]);
  });

  it('wraps a string tool result, because Gemini requires an object', () => {
    const [content] = toGeminiContents([
      { role: 'tool', responses: [{ id: 'c1', name: 'list_events', result: 'no events' }] },
    ]);
    expect(content.parts).toEqual([
      { functionResponse: { name: 'list_events', response: { result: 'no events' } } },
    ]);
  });

  it('passes an object tool result through unwrapped', () => {
    const [content] = toGeminiContents([
      { role: 'tool', responses: [{ id: 'c1', name: 'n', result: { count: 2 } }] },
    ]);
    expect(content.parts?.[0].functionResponse?.response).toEqual({ count: 2 });
  });

  it('keys tool results by name — Gemini has no call ids', () => {
    const [content] = toGeminiContents([
      {
        role: 'tool',
        responses: [
          { id: 'ignored-1', name: 'first', result: 'a' },
          { id: 'ignored-2', name: 'second', result: 'b' },
        ],
      },
    ]);
    expect(content.parts?.map((p) => p.functionResponse?.name)).toEqual(['first', 'second']);
  });

  it('keeps a whole exchange in order', () => {
    const contents = toGeminiContents([
      { role: 'user', text: 'q' },
      { role: 'model', text: '', toolCalls: [{ id: 'x-0', name: 'x', args: {} }], raw: { role: 'model', parts: [] } },
      { role: 'tool', responses: [{ id: 'x-0', name: 'x', result: 'r' }] },
      { role: 'user', text: 'and now?' },
    ]);
    expect(contents).toHaveLength(4);
    expect(contents[0].parts?.[0].text).toBe('q');
    expect(contents[3].parts?.[0].text).toBe('and now?');
  });
});
