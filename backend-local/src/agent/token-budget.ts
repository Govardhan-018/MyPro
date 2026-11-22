import type { LlmMessage, LlmTool } from '../llm/llm.service';

/**
 * Keeping a request inside the model's input budget. Pure.
 *
 * Groq's free tier allows **8,000 tokens per minute** on the default model,
 * and that ceiling applies to a single request too: ask for 8,402 and the
 * answer is a 413 that no amount of retrying will fix. The first real turn
 * on Render hit exactly that — one web page in a tool result, plus fourteen
 * tool schemas, plus the memory block, and the turn was over.
 *
 * Until now nothing in the system counted tokens at all (`AI_SYSTEM.md` §15).
 * This is the smallest thing that closes that gap: estimate, then drop the
 * least valuable context until it fits.
 *
 * The estimate is chars/4, the usual English approximation. It is wrong in
 * both directions — JSON and code run denser, prose lighter — so the budget
 * it is checked against is set well below the real ceiling. A tokenizer
 * would be exact and would also mean shipping one; this costs nothing and
 * turns a hard failure into a slightly shorter prompt.
 */

/** Rough but consistent: ~4 characters per token for English and JSON. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** What one message costs, including the structural overhead of its role. */
export function messageTokens(message: LlmMessage): number {
  const PER_MESSAGE_OVERHEAD = 4;

  if (message.role === 'user') return estimateTokens(message.text) + PER_MESSAGE_OVERHEAD;

  if (message.role === 'model') {
    const calls = (message.toolCalls ?? [])
      .map((c) => c.name.length + JSON.stringify(c.args).length)
      .reduce((a, b) => a + b, 0);
    return estimateTokens((message.text ?? '') + ' '.repeat(calls)) + PER_MESSAGE_OVERHEAD;
  }

  const results = message.responses
    .map((r) => r.name.length + String(r.result).length)
    .reduce((a, b) => a + b, 0);
  return estimateTokens(' '.repeat(results)) + PER_MESSAGE_OVERHEAD;
}

/** Tool schemas are paid for on every call, and they are not small. */
export function toolTokens(tools: readonly LlmTool[]): number {
  return tools.reduce(
    (total, tool) =>
      total + estimateTokens(tool.name + tool.description + JSON.stringify(tool.parameters)),
    0,
  );
}

export interface FitResult {
  messages: LlmMessage[];
  /** Estimated input tokens after trimming. */
  estimated: number;
  /** True when anything had to be dropped or shortened. */
  trimmed: boolean;
  /** For the log: what was given up. */
  detail?: string;
}

/**
 * Trim a conversation until it fits, giving up the least valuable things
 * first.
 *
 * The order is deliberate:
 *
 *  1. **Shorten old tool results.** A page of extracted article text from
 *     three steps ago is the single biggest thing in the window and the
 *     least likely to be needed again — the model has already read it and
 *     said what it made of it.
 *  2. **Drop the oldest conversation turns.** Older history is less
 *     relevant than recent history, and the episodic summaries exist
 *     precisely so that losing it is survivable.
 *  3. **Shorten the newest tool result.** Last resort, because this is
 *     usually what the model is about to answer from.
 *
 * The final user message is never dropped. A request that cannot fit even
 * then is returned as-is: failing loudly at the model is better than
 * silently answering a question we mangled.
 */
export function fitMessages(
  messages: readonly LlmMessage[],
  options: { systemTokens: number; toolTokens: number; maxInputTokens: number },
): FitResult {
  const overhead = options.systemTokens + options.toolTokens;
  const budget = options.maxInputTokens - overhead;

  let working: LlmMessage[] = messages.map((m) => ({ ...m }));
  const total = () => working.reduce((sum, m) => sum + messageTokens(m), 0);

  if (total() <= budget) {
    return { messages: working, estimated: total() + overhead, trimmed: false };
  }

  const given: string[] = [];

  // 1. Older tool results, oldest first, down to a headline-sized summary.
  const KEEP_OF_OLD_RESULT = 500;
  const lastToolIndex = working.map((m) => m.role).lastIndexOf('tool');
  for (let i = 0; i < working.length && total() > budget; i++) {
    const message = working[i];
    if (message.role !== 'tool' || i === lastToolIndex) continue;
    let shortened = 0;
    message.responses = message.responses.map((r) => {
      const text = String(r.result);
      if (text.length <= KEEP_OF_OLD_RESULT) return r;
      shortened += 1;
      return { ...r, result: `${text.slice(0, KEEP_OF_OLD_RESULT)}… [trimmed to fit the context]` };
    });
    if (shortened) given.push(`shortened ${shortened} earlier tool result(s)`);
  }

  // 2. Oldest conversation turns. Never the last message.
  let dropped = 0;
  while (total() > budget && working.length > 1) {
    working.shift();
    dropped += 1;
  }
  if (dropped) given.push(`dropped ${dropped} older message(s)`);

  // 3. The newest tool result, if it alone is still too big.
  if (total() > budget) {
    const index = working.map((m) => m.role).lastIndexOf('tool');
    const message = index >= 0 ? working[index] : undefined;
    if (message && message.role === 'tool') {
      const perResult = Math.max(
        400,
        Math.floor((budget * 4) / Math.max(1, message.responses.length)),
      );
      message.responses = message.responses.map((r) => {
        const text = String(r.result);
        return text.length <= perResult
          ? r
          : { ...r, result: `${text.slice(0, perResult)}… [trimmed to fit the context]` };
      });
      given.push('shortened the latest tool result');
    }
  }

  return {
    messages: working,
    estimated: total() + overhead,
    trimmed: true,
    detail: given.join(', ') || 'nothing could be trimmed',
  };
}
