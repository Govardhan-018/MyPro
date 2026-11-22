import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  fitMessages,
  messageTokens,
  toolTokens,
} from '../src/agent/token-budget';
import { budgetFor, EFFORT_MODES } from '../src/agent/effort';
import type { LlmMessage, LlmTool } from '../src/llm/llm.service';

/**
 * Keeping a request inside the model's input budget.
 *
 * From a real turn on Render: `413 Request too large ... TPM: Limit 8000,
 * Requested 8402`. One extracted web page in a tool result, fourteen tool
 * schemas and the memory block were enough to exceed the free tier's entire
 * per-minute allowance in a single call — and because the error body says
 * `rate_limit_exceeded`, it was retried three times before failing.
 *
 * The estimate here is approximate on purpose. What must hold is the
 * ordering: shorten old tool results before dropping history, drop history
 * before touching the newest result, and never drop the message the user
 * just sent.
 */

const user = (text: string): LlmMessage => ({ role: 'user', text });
const model = (text: string): LlmMessage => ({ role: 'model', text });
const tool = (result: string, name = 'web_search'): LlmMessage => ({
  role: 'tool',
  responses: [{ id: 'c1', name, result }],
});

const FITS_EVERYTHING = { systemTokens: 0, toolTokens: 0, maxInputTokens: 100_000 };

describe('estimateTokens', () => {
  it('approximates four characters to the token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });

  it('counts a tool schema, which is paid for on every single call', () => {
    const schema: LlmTool = {
      name: 'web_search',
      description: 'Search the web for current information.',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    };
    expect(toolTokens([schema])).toBeGreaterThan(20);
    expect(toolTokens([schema, schema])).toBe(toolTokens([schema]) * 2);
  });

  it('counts a tool result by its content, not its wrapper', () => {
    expect(messageTokens(tool('x'.repeat(4_000)))).toBeGreaterThan(900);
  });
});

describe('fitMessages', () => {
  it('leaves a conversation that already fits completely alone', () => {
    const messages = [user('hello'), model('hi')];
    const result = fitMessages(messages, FITS_EVERYTHING);

    expect(result.trimmed).toBe(false);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual(messages[0]);
  });

  it('counts the system prompt and the tool schemas against the budget', () => {
    const messages = [user('short')];
    const tight = fitMessages(messages, {
      systemTokens: 900,
      toolTokens: 900,
      maxInputTokens: 1_000,
    });
    // The overhead alone blows the budget, so it reports having tried.
    expect(tight.trimmed).toBe(true);
  });

  it('shortens an old tool result before dropping any conversation', () => {
    const messages = [
      user('find me something'),
      model('looking'),
      tool('x'.repeat(20_000)),
      model('here is what I found'),
      user('and now this'),
      tool('y'.repeat(100)),
    ];

    const result = fitMessages(messages, {
      systemTokens: 100,
      toolTokens: 100,
      maxInputTokens: 2_000,
    });

    expect(result.trimmed).toBe(true);
    // Every turn survives...
    expect(result.messages).toHaveLength(6);
    // ...but the big old result was cut down.
    const old = result.messages[2];
    expect(old.role).toBe('tool');
    if (old.role === 'tool') {
      expect(String(old.responses[0].result).length).toBeLessThan(600);
      expect(String(old.responses[0].result)).toContain('trimmed to fit');
    }
  });

  it('keeps the newest tool result intact while older ones can be cut', () => {
    const messages = [tool('x'.repeat(8_000), 'old'), user('q'), tool('y'.repeat(600), 'new')];
    const result = fitMessages(messages, {
      systemTokens: 0,
      toolTokens: 0,
      maxInputTokens: 1_000,
    });

    const newest = result.messages[result.messages.length - 1];
    expect(newest.role).toBe('tool');
    if (newest.role === 'tool') {
      expect(String(newest.responses[0].result)).toBe('y'.repeat(600));
    }
  });

  it('drops the oldest turns when shortening is not enough', () => {
    const messages = Array.from({ length: 40 }, (_, i) => user(`message number ${i} `.repeat(20)));
    const result = fitMessages(messages, {
      systemTokens: 0,
      toolTokens: 0,
      maxInputTokens: 500,
    });

    expect(result.messages.length).toBeLessThan(40);
    // What survives is the end of the conversation, not the start.
    const last = result.messages[result.messages.length - 1];
    expect(last).toEqual(messages[messages.length - 1]);
  });

  it('never drops the message the user just sent', () => {
    const messages = [user('old'.repeat(5_000)), user('the actual question')];
    const result = fitMessages(messages, {
      systemTokens: 0,
      toolTokens: 0,
      maxInputTokens: 50,
    });

    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages[result.messages.length - 1].role).toBe('user');
  });

  it('reports what it gave up, so the log can explain a short answer', () => {
    const messages = [tool('x'.repeat(20_000)), user('q'), model('a'), user('q2')];
    const result = fitMessages(messages, {
      systemTokens: 0,
      toolTokens: 0,
      maxInputTokens: 300,
    });
    expect(result.detail).toBeTruthy();
    expect(result.estimated).toBeGreaterThan(0);
  });
});

describe('the effort budgets against a free Groq tier', () => {
  // The limit that produced the 413. Every mode must leave room under it
  // for the output allowance and for the estimate being approximate.
  const TPM = 8_000;

  it('keeps input plus output inside the per-minute ceiling in every mode', () => {
    for (const mode of EFFORT_MODES) {
      const budget = budgetFor(mode);
      expect(budget.maxInputTokens + budget.maxOutputTokens, mode).toBeLessThanOrEqual(TPM);
    }
  });

  it('leaves real headroom, because the estimate is only an estimate', () => {
    for (const mode of EFFORT_MODES) {
      expect(budgetFor(mode).maxInputTokens, mode).toBeLessThanOrEqual(TPM * 0.85);
    }
  });

  it('still grows from light to deep', () => {
    expect(budgetFor('light').maxInputTokens).toBeLessThan(budgetFor('default').maxInputTokens);
    expect(budgetFor('default').maxInputTokens).toBeLessThan(budgetFor('deep').maxInputTokens);
  });

  it('keeps a single tool result well under the whole input budget', () => {
    for (const mode of EFFORT_MODES) {
      const budget = budgetFor(mode);
      // chars/4: one result must not be able to fill the window by itself.
      expect(budget.toolResultChars / 4, mode).toBeLessThan(budget.maxInputTokens * 0.75);
    }
  });
});
