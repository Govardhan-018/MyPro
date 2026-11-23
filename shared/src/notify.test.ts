import { describe, it, expect } from 'vitest';
import { notificationChannelFor, notificationHash, hashFromDeeplink } from './notify';
import type { ScheduleOccurrence } from './types';

/**
 * How each armed notification looks and where a tap lands (Feature: proper
 * native notifications). Pure mapping, so pinned directly.
 */
function occ(patch: Partial<ScheduleOccurrence>): ScheduleOccurrence {
  return {
    id: 'x',
    schedule_id: 's',
    name: 'n',
    action_type: 'notify',
    title: 't',
    body: null,
    at: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('notificationChannelFor', () => {
  it('routes briefs/reports to their own channel', () => {
    expect(notificationChannelFor(occ({ action_type: 'report' }))).toBe('briefs');
  });
  it('routes everything else to reminders', () => {
    expect(notificationChannelFor(occ({ action_type: 'notify' }))).toBe('reminders');
    expect(notificationChannelFor(occ({ action_type: 'chat_message' }))).toBe('reminders');
    expect(notificationChannelFor(occ({ kind: 'calendar', action_type: 'notify' }))).toBe('reminders');
  });
});

describe('notificationHash (tap → the right place)', () => {
  it('opens Today as the empty hash', () => {
    expect(notificationHash(occ({ deeplink: 'today' }))).toBe('');
  });

  it('opens the assistant for a report', () => {
    expect(notificationHash(occ({ action_type: 'report', deeplink: 'assistant' }))).toBe('assistant');
  });

  it('opens a calendar reminder focused on its event and day', () => {
    const hash = notificationHash(
      occ({
        kind: 'calendar',
        deeplink: 'calendar',
        deeplink_id: 'event-123',
        deeplink_at: '2026-03-04T09:00:00.000Z',
      }),
    );
    expect(hash.startsWith('calendar?')).toBe(true);
    const params = new URLSearchParams(hash.split('?')[1]);
    expect(params.get('event')).toBe('event-123');
    expect(params.get('at')).toBe('2026-03-04T09:00:00.000Z');
  });

  it('falls back to the plain calendar hash when no event id is carried', () => {
    expect(notificationHash(occ({ deeplink: 'calendar' }))).toBe('calendar');
  });

  it('falls back to the action-type heuristic when no deeplink is set', () => {
    expect(notificationHash(occ({ action_type: 'report' }))).toBe('assistant');
    expect(notificationHash(occ({ action_type: 'notify' }))).toBe('');
  });
});

describe('hashFromDeeplink (server push paths → router hash)', () => {
  it('maps a known path, stripping the leading slash', () => {
    expect(hashFromDeeplink('/assistant')).toBe('assistant');
    expect(hashFromDeeplink('calendar')).toBe('calendar');
  });

  it('treats home / today / empty as the empty hash', () => {
    expect(hashFromDeeplink('/')).toBe('');
    expect(hashFromDeeplink('/today')).toBe('');
    expect(hashFromDeeplink('')).toBe('');
    expect(hashFromDeeplink(null)).toBe('');
    expect(hashFromDeeplink(undefined)).toBe('');
  });

  it('rejects an unknown target rather than guessing', () => {
    expect(hashFromDeeplink('/evil')).toBe('');
  });
});
