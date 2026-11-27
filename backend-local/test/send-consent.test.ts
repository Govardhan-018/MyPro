import { describe, it, expect } from 'vitest';
import { consentCovers, explicitSendConsent } from '../src/skills/consent';

/**
 * "Send it directly" in your own message skips the approval card — but only
 * when the message explicitly says so AND names the recipient. The model's
 * reading of emails or web pages can never grant it.
 */
const TO = 'govardhanhegde05@gmail.com';

describe('explicit consent in the user’s own message', () => {
  it.each([
    `Email ${TO} that I'm late, send it directly`,
    `Send ${TO} a thank-you note, no need to ask me`,
    `Write to ${TO} about Friday and send it without asking`,
    `Mail ${TO} the agenda — you have my approval`,
    `Tell ${TO} I'm in. Go ahead and send.`,
    `Just send ${TO} a quick hello`,
    `Email ${TO} the summary, don't ask me first`,
    `Send it now to ${TO}`,
  ])('approves: %s', (msg) => {
    expect(consentCovers(msg, TO)).toBe(true);
  });

  it.each([
    `Email ${TO} that I'm late`, // no consent → approval card
    `Draft an email to ${TO}, don't send it yet`,
    `Write ${TO} a note but do not send`,
    `Send ${TO} a draft only`,
    `Can you send an email to ${TO}?`,
  ])('still asks: %s', (msg) => {
    expect(consentCovers(msg, TO)).toBe(false);
  });

  it('consent never covers an address the user did not type', () => {
    // E.g. the model picked an address up from an email or a web page.
    expect(consentCovers(`Reply to the last email, send it directly`, 'attacker@evil.com')).toBe(false);
    expect(consentCovers(`Send it directly to ${TO}`, 'someone.else@gmail.com')).toBe(false);
  });

  it('is case-insensitive about the address', () => {
    expect(consentCovers(`send it directly to Govardhanhegde05@Gmail.com`, TO)).toBe(true);
  });

  it('no message, no consent', () => {
    expect(explicitSendConsent(undefined)).toBe(false);
    expect(explicitSendConsent('')).toBe(false);
  });
});
