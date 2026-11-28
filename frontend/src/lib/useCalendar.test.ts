import { describe, it, expect } from 'vitest';
import {
  dateKeyOf,
  describeEventTime,
  effectiveLead,
  eventActionState,
  eventBody,
  eventPhaseOf,
  leadLabel,
  remindAt,
  rowToEvent,
  type CalEvent,
} from './useCalendar';

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

describe('one store for reminders and events (0025)', () => {
  it('maps kind, note and the chosen lead from a row', () => {
    const r = rowToEvent({
      id: 'r1',
      title: 'Pay rent',
      starts_at: '2026-12-01T14:00:00Z',
      kind: 'reminder',
      description: 'landlord account',
      event_reminders: [{ minutes_before: 15 }],
    });
    expect(r).toMatchObject({ kind: 'reminder', note: 'landlord account', leadMinutes: 15, source: 'calendar' });
    expect(r.tone).toBe('cyan');
    // A row from before 0025 is an event with no lead of its own.
    expect(rowToEvent({ id: 'e1', title: 'x', starts_at: '2026-12-01T14:00:00Z' })).toMatchObject({
      kind: 'event',
      leadMinutes: null,
    });
  });

  it('effectiveLead keeps render’s baseline when nothing was chosen', () => {
    expect(effectiveLead({ kind: 'event', allDay: false, leadMinutes: null })).toBe(60);
    expect(effectiveLead({ kind: 'reminder', allDay: false, leadMinutes: null })).toBe(0);
    expect(effectiveLead({ kind: 'event', allDay: false, leadMinutes: 15 })).toBe(15);
    // A sub-day lead on an all-day item collapses to the morning-of.
    expect(effectiveLead({ kind: 'event', allDay: true, leadMinutes: 30 })).toBe(0);
    expect(effectiveLead({ kind: 'event', allDay: true, leadMinutes: 1440 })).toBe(1440);
  });

  it('remindAt = start − lead; all-day at 09:00 local on its date', () => {
    expect(
      remindAt({ startsAt: '2026-12-01T14:00:00.000Z', allDay: false, leadMinutes: 30, kind: 'reminder' })?.toISOString(),
    ).toBe('2026-12-01T13:30:00.000Z');
    const allDay = remindAt({ startsAt: '2026-12-01T00:00:00.000Z', allDay: true, leadMinutes: 1440, kind: 'event' });
    // 09:00 New York on 30 Nov (the day before) = 14:00Z.
    expect(allDay?.toISOString()).toBe('2026-11-30T14:00:00.000Z');
  });

  it('labels leads for the list', () => {
    expect(leadLabel(0)).toBe('At time');
    expect(leadLabel(15)).toBe('15 min before');
    expect(leadLabel(60)).toBe('1 hr before');
    expect(leadLabel(1440)).toBe('1 day before');
    expect(leadLabel(0, true)).toBe('Morning of');
  });

  it('eventBody: a reminder carries a note and one lead, never an end or a location', () => {
    const body = eventBody({
      kind: 'reminder',
      title: '  Call Anu  ',
      date: '2026-12-01',
      startTime: '18:30',
      endTime: '19:00',
      allDay: false,
      location: 'ignored',
      note: ' about the trip ',
      leadMinutes: 15,
    });
    expect(body).toEqual({
      title: 'Call Anu',
      starts_at: new Date('2026-12-01T18:30:00').toISOString(),
      all_day: false,
      description: 'about the trip',
      kind: 'reminder',
      reminders: [{ minutes_before: 15, channel: 'push' }],
    });
  });

  it('eventBody: an all-day item is stored as UTC midnight and only whole-day leads survive', () => {
    const body = eventBody({ kind: 'event', title: 'Trip', date: '2026-12-05', allDay: true, leadMinutes: 90 });
    expect(body.starts_at).toBe('2026-12-05T00:00:00.000Z');
    expect(body.reminders).toEqual([{ minutes_before: 0, channel: 'push' }]);
  });

  it('eventBody: refuses a missing time, a missing title, and an end before the start', () => {
    expect(() => eventBody({ title: 'x', date: '2026-12-01', allDay: false })).toThrow(/time/);
    expect(() => eventBody({ title: ' ', date: '2026-12-01', startTime: '10:00', allDay: false })).toThrow(/title/);
    expect(() =>
      eventBody({ kind: 'event', title: 'x', date: '2026-12-01', startTime: '10:00', endTime: '09:00', allDay: false }),
    ).toThrow(/end time/);
  });
});
