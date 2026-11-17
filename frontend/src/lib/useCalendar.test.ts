import { describe, it, expect } from 'vitest';
import { dateKeyOf, type CalEvent } from './useCalendar';

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
