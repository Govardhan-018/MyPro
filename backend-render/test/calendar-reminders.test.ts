import { describe, it, expect } from 'vitest';
import {
  calendarReminderLeads,
  calendarBody,
  calendarItemBody,
  calendarReminderMoments,
} from '../src/schedules/schedules.service';

/**
 * Calendar events become notification moments (Feature: calendar reminders).
 * The timing rule and the body copy are pure, so they are tested here without
 * a database; the DB wiring around them lives in `upcoming()`.
 */
describe('calendarReminderLeads', () => {
  it('a timed event reminds one hour before and at the start', () => {
    expect(calendarReminderLeads(false, [])).toEqual([0, 60]);
  });

  it('a chosen lead replaces the baseline: that lead plus the moment itself', () => {
    expect(calendarReminderLeads(false, [15])).toEqual([0, 15]);
    expect(calendarReminderLeads(false, [10, 60, 1440, 10])).toEqual([0, 10, 60, 1440]);
  });

  it('drops negative / non-finite custom values', () => {
    expect(calendarReminderLeads(false, [-5, Number.NaN, 15])).toEqual([0, 15]);
    expect(calendarReminderLeads(false, [-5])).toEqual([0, 60]);
  });

  it('a reminder with no lead fires only at its time', () => {
    expect(calendarReminderLeads(false, [], 'reminder')).toEqual([0]);
    expect(calendarReminderLeads(false, [30], 'reminder')).toEqual([0, 30]);
  });

  it('an all-day event only reminds at the start — never an hour before midnight', () => {
    expect(calendarReminderLeads(true, [60, 120])).toEqual([0]);
  });
});

describe('calendarBody', () => {
  it('reads naturally for the baseline leads', () => {
    expect(calendarBody(0, null)).toBe('Starting now');
    expect(calendarBody(60, null)).toBe('In 1 hour');
  });

  it('humanises minutes, hours and days', () => {
    expect(calendarBody(15, null)).toBe('In 15 minutes');
    expect(calendarBody(120, null)).toBe('In 2 hours');
    expect(calendarBody(1440, null)).toBe('In 1 day');
    expect(calendarBody(90, null)).toBe('In 1h 30m');
  });

  it('appends a location when there is one', () => {
    expect(calendarBody(60, 'Office')).toBe('In 1 hour · Office');
    expect(calendarBody(0, 'Clinic')).toBe('Starting now · Clinic');
  });
});

describe('calendarReminderMoments', () => {
  const iso = (d: Date) => d.toISOString();

  it('remindAt = start − lead for a timed item', () => {
    const m = calendarReminderMoments(
      { starts_at: '2026-12-01T10:00:00.000Z', all_day: false, kind: 'reminder' },
      [15],
    );
    expect(m.map((x) => iso(x.at))).toEqual(['2026-12-01T10:00:00.000Z', '2026-12-01T09:45:00.000Z']);
  });

  it('anchors an all-day item to 09:00 in the user zone, on its own date', () => {
    // Stored as UTC midnight of 1 Dec; 09:00 in Kolkata is 03:30Z the same day.
    const m = calendarReminderMoments(
      { starts_at: '2026-12-01T00:00:00.000Z', all_day: true },
      [],
      'Asia/Kolkata',
    );
    expect(m.map((x) => iso(x.at))).toEqual(['2026-12-01T03:30:00.000Z']);
  });

  it('moves an all-day reminder by whole days only; sub-day leads collapse onto the anchor', () => {
    const m = calendarReminderMoments(
      { starts_at: '2026-12-01T00:00:00.000Z', all_day: true },
      [15, 1440],
      'America/New_York',
    );
    // 09:00 EST = 14:00Z; a day before is 30 Nov.
    expect(m.map((x) => iso(x.at))).toEqual(['2026-12-01T14:00:00.000Z', '2026-11-30T14:00:00.000Z']);
    expect(m.map((x) => x.minutesBefore)).toEqual([0, 1440]);
  });

  it('falls back to UTC for an unknown zone and ignores an unparseable start', () => {
    expect(
      calendarReminderMoments({ starts_at: '2026-12-01T00:00:00.000Z', all_day: true }, [], 'Not/AZone').map((x) =>
        iso(x.at),
      ),
    ).toEqual(['2026-12-01T09:00:00.000Z']);
    expect(calendarReminderMoments({ starts_at: 'nope' }, [])).toEqual([]);
  });
});

describe('calendarItemBody', () => {
  it('a reminder at its moment shows its note', () => {
    expect(calendarItemBody({ kind: 'reminder', location: null, description: 'Bring the forms' }, 0)).toBe(
      'Bring the forms',
    );
    expect(calendarItemBody({ kind: 'reminder', location: null }, 0)).toBe('Now');
    expect(calendarItemBody({ kind: 'reminder', location: null }, 15)).toBe('In 15 minutes');
  });

  it('an all-day item says today / tomorrow', () => {
    expect(calendarItemBody({ all_day: true, location: 'Home' }, 0)).toBe('Today · Home');
    expect(calendarItemBody({ all_day: true, location: null }, 1440)).toBe('Tomorrow');
  });

  it('an event keeps the original copy', () => {
    expect(calendarItemBody({ kind: 'event', location: 'Office' }, 60)).toBe('In 1 hour · Office');
  });
});
