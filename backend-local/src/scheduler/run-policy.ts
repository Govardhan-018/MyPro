/**
 * The scheduler's decisions, as pure functions — what a schedule says, when a
 * failed run may be retried, and how a model's email draft is read. Kept free
 * of I/O so every rule here is unit-tested (`test/scheduler-policy.test.ts`).
 */

/** Total tries for one occurrence: the first run plus three retries. */
export const MAX_ATTEMPTS = 4;

/** Back-off before retry n (1-based): 2 min, 10 min, 30 min. */
const RETRY_DELAYS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];

export interface PayloadShape {
  name: string;
  action_payload: Record<string, unknown> | null;
}

function str(payload: Record<string, unknown> | null, key: string): string | undefined {
  const v = payload?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * "Remind me": what the notification says. The UI writes `{ title, body }`;
 * older rows carry `message`, `text` or `prompt` — all honoured, so no
 * existing reminder loses its words.
 */
export function reminderContent(s: PayloadShape): { title: string; body: string } {
  const p = s.action_payload;
  return {
    title: str(p, 'title') ?? s.name,
    body: str(p, 'body') ?? str(p, 'message') ?? str(p, 'text') ?? str(p, 'prompt') ?? '',
  };
}

/**
 * "AI message": a `prompt` is a task for the AI to carry out. A bare `text`
 * (rows the assistant created before this change) is a fixed message to post
 * as-is, which is what those rows always meant.
 */
export function chatInstruction(
  s: PayloadShape,
): { kind: 'ai'; prompt: string } | { kind: 'text'; text: string } {
  const prompt = str(s.action_payload, 'prompt');
  if (prompt) return { kind: 'ai', prompt };
  return { kind: 'text', text: str(s.action_payload, 'text') ?? s.name };
}

/** "Email": the destination and the instructions the AI writes from. */
export function emailInstruction(
  s: PayloadShape,
): { to: string; prompt: string } | { error: string } {
  const to = str(s.action_payload, 'to');
  const prompt = str(s.action_payload, 'prompt') ?? str(s.action_payload, 'instructions');
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { error: 'This email schedule has no valid destination address.' };
  }
  if (!prompt) return { error: 'This email schedule has no instructions to write from.' };
  return { to, prompt };
}

/**
 * After a failed attempt: retry, or give up.
 *
 * Only failures we *know* did nothing are retryable (the model was down, the
 * mail service never received the request). A recurring schedule never
 * retries past its own next occurrence — that occurrence is the retry.
 */
export function afterFailure(input: {
  attempt: number;
  retryable: boolean;
  now: Date;
  nextOccurrence: Date | null;
}): { retryAt: Date } | { giveUp: true } {
  if (!input.retryable || input.attempt >= MAX_ATTEMPTS) return { giveUp: true };
  const delay = RETRY_DELAYS_MS[Math.min(input.attempt, RETRY_DELAYS_MS.length) - 1];
  const retryAt = new Date(input.now.getTime() + delay);
  if (input.nextOccurrence && retryAt >= input.nextOccurrence) return { giveUp: true };
  return { retryAt };
}

/**
 * Read the model's email draft. Asked for JSON `{ "subject", "body" }`; tolerates
 * a fenced block or prose around it, and falls back to "first line is the
 * subject" rather than failing a send over formatting.
 */
export function parseEmailDraft(
  raw: string,
  fallbackSubject: string,
): { subject: string; body: string } | null {
  const text = raw.trim();
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { subject?: unknown; body?: unknown };
      const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
      const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
      if (body) return { subject: (subject || fallbackSubject).slice(0, 300), body };
    } catch {
      /* fall through to the plain-text reading */
    }
  }
  const lines = text.replace(/^```\w*\n?|```$/g, '').trim().split('\n');
  const first = lines[0].replace(/^subject:\s*/i, '').trim();
  const rest = lines.slice(1).join('\n').trim();
  if (rest) return { subject: (first || fallbackSubject).slice(0, 300), body: rest };
  return { subject: fallbackSubject.slice(0, 300), body: text };
}

/** A short excerpt for a notification body or the run history. */
export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
