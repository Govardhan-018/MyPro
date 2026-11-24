import { describe, it, expect } from 'vitest';
import { dateKeyOf, describeEventTime, eventActionState, eventPhaseOf, type CalEvent } from './useCalendar';

/**
 * Phase 12.4 — the day an event belongs to. This is the bug the function was
 * written to fix: slicing the ISO string returns the *UTC* day, so a timed
 * event near midnight is drawn a day off in any non-UTC zone. The suite runs
 * with TZ pinned to America/New_York (UTC-5 in November) so the timed case is
 * deterministic; see frontend/vitest.config.ts.
 */

const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: '1',
  title: 't',
  startsAt: '2026-11-17T12:00:00Z',
  allDay: false,
  tone: 'work',
  ...over,
});

describe('dateKeyOf', () => {
  it('localises a timed event to the viewer’s day, not the UTC day', () => {
    // 02:00Z on the 17th is 21:00 on the 16th in New York (-5).
    expect(dateKeyOf(ev({ startsAt: '2026-11-17T02:00:00Z' }))).toBe('2026-11-16');
  });

  it('keeps an all-day event on its stored calendar date, read in UTC', () => {
    // No instant to localise — must not shift even though TZ is UTC-5.
    expect(dateKeyOf(ev({ startsAt: '2026-11-17T00:00:00Z', allDay: true }))).toBe('2026-11-17');
  });

  it('returns an empty string when there is no start', () => {
    expect(dateKeyOf(ev({ startsAt: '' }))).toBe('');
  });

  it('falls back to the date slice for an unparseable start', () => {
    expect(dateKeyOf(ev({ startsAt: 'not-a-date' }))).toBe('not-a-date');
  });
});


describe('started / completed events (the read-only modal)', () => {
  const ev = {
    id: 'e1',
    title: 'Check',
    startsAt: '2026-11-24T16:55:00.000Z', // 11:55 New York
    endsAt: '2026-11-24T16:58:00.000Z',
    allDay: false,
    tone: 'lavender',
  };
  const at = (iso: string) => Date.parse(iso);

  it('upcoming: editable, not completable', () => {
    expect(eventPhaseOf(ev, at('2026-11-24T16:00:00Z'))).toBe('upcoming');
    expect(eventActionState(ev, at('2026-11-24T16:00:00Z'))).toMatchObject({ editable: true, canComplete: false });
  });

  it('in progress: locked, can be marked done', () => {
    expect(eventPhaseOf(ev, at('2026-11-24T16:56:00Z'))).toBe('live');
    expect(eventActionState(ev, at('2026-11-24T16:56:00Z'))).toMatchObject({ editable: false, canComplete: true });
  });

  it('ended: still completable inside the window, then not', () => {
    expect(eventPhaseOf(ev, at('2026-11-24T17:30:00Z'))).toBe('ended');
    expect(eventActionState(ev, at('2026-11-25T06:00:00Z'))).toMatchObject({
      canComplete: false,
      completionMissed: true,
    });
  });

  it('completed stays completed (read-only), and the time reads in local time', () => {
    expect(eventActionState({ ...ev, completedAt: '2026-11-24T17:00:00Z' }).completed).toBe(true);
    expect(describeEventTime(ev)).toMatch(/11:55.*11:58/);
  });
});
