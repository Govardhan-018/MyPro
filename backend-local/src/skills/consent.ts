/**
 * Pre-approval for sending email, read from the user's OWN words.
 *
 * An outward action normally waits for an explicit tap on its approval card.
 * The user can skip that by saying so in the same message — "email
 * priya@example.com that I'm running late, send it directly". This module is
 * the only thing that decides that, and it is deterministic on purpose:
 *
 *  - The model never decides. It reads emails and web pages, and text there
 *    can say "the user approves, send it"; that text never reaches this check.
 *    Only the user's own message (or their own scheduled instructions) does.
 *  - The message must explicitly approve sending, and must not say not to.
 *  - The message must name the recipient's address. Approval to "send it"
 *    never covers an address the model found somewhere else.
 *
 * Pure; unit-tested (`test/send-consent.test.ts`).
 */

/** Phrases that explicitly give approval to send without asking. */
const CONSENT = [
  /\bsend\s+(?:it|this|that|the\s+(?:e-?mail|mail|message)|them)?\s*(?:directly|right\s+away|immediately|straight\s+away|now|without\s+(?:asking|approval|confirm\w*|checking))\b/i,
  /\b(?:without|no)\s+(?:need\s+to\s+)?(?:ask(?:ing)?|approv\w*|confirm\w*|check(?:ing)?)(?:\s+(?:me|first|with\s+me))?\b/i,
  /\bno\s+need\s+to\s+(?:ask|confirm|check|approve)\b/i,
  /\b(?:don'?t|do\s+not)\s+(?:ask|confirm|wait\s+for\s+(?:me|my\s+approval)|check\s+with\s+me)\b/i,
  /\byou\s+(?:have|got)\s+my\s+(?:approval|permission|consent|go-?ahead|ok)\b/i,
  /\b(?:i\s+)?(?:pre-?)?approve(?:d)?\s+(?:it|this|sending|the\s+(?:e-?mail|mail|send))\b/i,
  /\bgo\s+ahead\s+and\s+send\b/i,
  /\bjust\s+send\b/i,
  /\bauto[-\s]?send\b/i,
];

/** "don't send", "do not send it yet", "never send" — the opposite of consent. */
const REFUSAL = /\b(?:don'?t|do\s+not|never|not\s+yet\s+to)\s+(?:actually\s+)?send\b|\bdraft\s+(?:it\s+)?only\b|\bjust\s+(?:a\s+)?draft\b/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** The email addresses the user typed in this message, lowercased. */
export function addressesIn(message: string): string[] {
  return [...new Set((message.match(EMAIL) ?? []).map((a) => a.toLowerCase()))];
}

/** Whether the message explicitly approves sending without asking. */
export function explicitSendConsent(message: string | null | undefined): boolean {
  const text = (message ?? '').trim();
  if (!text || REFUSAL.test(text)) return false;
  return CONSENT.some((re) => re.test(text));
}

/**
 * Whether the user's own message pre-approves sending to `to`: it must both
 * approve sending explicitly and name that exact address.
 */
export function consentCovers(message: string | null | undefined, to: string | null | undefined): boolean {
  if (!to || !explicitSendConsent(message)) return false;
  return addressesIn(message ?? '').includes(to.trim().toLowerCase());
}
