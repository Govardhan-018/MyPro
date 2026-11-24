import { describe, it, expect } from 'vitest';
import {
  MAX_ATTEMPTS,
  afterFailure,
  chatInstruction,
  emailInstruction,
  parseEmailDraft,
  reminderContent,
} from '../src/scheduler/run-policy';
import { deviceHoldsLocalCopy } from '../src/notifications/push.service';

/**
 * The three-mode scheduler's rules (Remind me · AI message · Email).
 *
 * The first bug these pin: the UI stored a reminder's words under `prompt`
 * while the drain loop read `title`/`body`, so every reminder arrived as just
 * its name; and "chat message" posted its own name verbatim instead of asking
 * the AI to do anything.
 */

const row = (action_payload: Record<string, unknown> | null, name = 'Stretch') => ({
  name,
  action_payload,
});

describe('reminderContent', () => {
  it('uses the UI fields', () => {
    expect(reminderContent(row({ title: 'Stand up', body: 'Two minutes' }))).toEqual({
      title: 'Stand up',
      body: 'Two minutes',
    });
  });
  it('honours legacy keys so no existing reminder loses its words', () => {
    expect(reminderContent(row({ prompt: 'Look away' })).body).toBe('Look away');
    expect(reminderContent(row({ text: 'Water' })).body).toBe('Water');
    expect(reminderContent(row(null))).toEqual({ title: 'Stretch', body: '' });
  });
});

describe('chatInstruction', () => {
  it('a prompt is a task for the AI', () => {
    expect(chatInstruction(row({ prompt: 'Summarise the news' }))).toEqual({
      kind: 'ai',
      prompt: 'Summarise the news',
    });
  });
  it('legacy fixed text is still posted verbatim', () => {
    expect(chatInstruction(row({ text: 'Good morning!' }))).toEqual({ kind: 'text', text: 'Good morning!' });
  });
});

describe('emailInstruction', () => {
  it('needs a valid address and instructions', () => {
    expect(emailInstruction(row({ to: 'bob@example.com', prompt: 'Thank Bob' }))).toEqual({
      to: 'bob@example.com',
      prompt: 'Thank Bob',
    });
    expect(emailInstruction(row({ to: 'bob', prompt: 'x' }))).toHaveProperty('error');
    expect(emailInstruction(row({ to: 'bob@example.com' }))).toHaveProperty('error');
  });
});

describe('afterFailure (retry policy)', () => {
  const now = new Date('2026-11-24T08:00:00Z');

  it('retries a retryable failure with growing back-off', () => {
    const one = afterFailure({ attempt: 1, retryable: true, now, nextOccurrence: null });
    const two = afterFailure({ attempt: 2, retryable: true, now, nextOccurrence: null });
    expect('retryAt' in one && one.retryAt.getTime() - now.getTime()).toBe(2 * 60_000);
    expect('retryAt' in two && two.retryAt.getTime() - now.getTime()).toBe(10 * 60_000);
  });

  it('never retries what may already have happened, and stops after MAX_ATTEMPTS', () => {
    expect(afterFailure({ attempt: 1, retryable: false, now, nextOccurrence: null })).toEqual({ giveUp: true });
    expect(afterFailure({ attempt: MAX_ATTEMPTS, retryable: true, now, nextOccurrence: null })).toEqual({
      giveUp: true,
    });
  });

  it('a recurring schedule never retries past its own next occurrence', () => {
    const next = new Date(now.getTime() + 60_000);
    expect(afterFailure({ attempt: 1, retryable: true, now, nextOccurrence: next })).toEqual({ giveUp: true });
  });
});

describe('parseEmailDraft', () => {
  it('reads JSON, even fenced or with prose around it', () => {
    expect(parseEmailDraft('```json\n{"subject":"Hi","body":"Hello Bob"}\n```', 'x')).toEqual({
      subject: 'Hi',
      body: 'Hello Bob',
    });
    expect(parseEmailDraft('Sure! {"subject":"S","body":"B"} Hope that helps', 'x')).toEqual({
      subject: 'S',
      body: 'B',
    });
  });
  it('falls back to "first line is the subject"', () => {
    expect(parseEmailDraft('Subject: Thanks\nHi Bob,\nThanks.', 'fallback')).toEqual({
      subject: 'Thanks',
      body: 'Hi Bob,\nThanks.',
    });
  });
  it('an empty reply is no email', () => {
    expect(parseEmailDraft('   ', 'x')).toBeNull();
  });
});

describe('deviceHoldsLocalCopy (no duplicate reminders)', () => {
  const due = new Date('2026-11-24T08:30:00Z');
  const edited = new Date('2026-11-23T20:00:00Z');

  it('a phone that armed after the last edit and before the moment already shows it', () => {
    expect(deviceHoldsLocalCopy('2026-11-24T07:00:00Z', { dueAt: due, scheduleUpdatedAt: edited })).toBe(true);
  });
  it('a phone that armed before the edit does not (it holds the old time) — push it', () => {
    expect(deviceHoldsLocalCopy('2026-11-23T19:00:00Z', { dueAt: due, scheduleUpdatedAt: edited })).toBe(false);
  });
  it('outside the 48h armed window, or never armed — push it', () => {
    expect(deviceHoldsLocalCopy('2026-11-21T07:00:00Z', { dueAt: due, scheduleUpdatedAt: new Date(0) })).toBe(
      false,
    );
    expect(deviceHoldsLocalCopy(null, { dueAt: due, scheduleUpdatedAt: edited })).toBe(false);
  });
});
