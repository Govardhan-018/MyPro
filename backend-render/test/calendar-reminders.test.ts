import { describe, it, expect } from 'vitest';
import { calendarReminderLeads, calendarBody } from '../src/schedules/schedules.service';

/**
 * Calendar events become notification moments (Feature: calendar reminders).
 * The timing rule and the body copy are pure, so they are tested here without
 * a database; the DB wiring around them lives in `upcoming()`.
 */
describe('calendarReminderLeads', () => {
  it('a timed event reminds one hour before and at the start', () => {
    expect(calendarReminderLeads(false, [])).toEqual([0, 60]);
  });

  it('merges and de-duplicates custom reminders, sorted', () => {
    expect(calendarReminderLeads(false, [10, 60, 1440])).toEqual([0, 10, 60, 1440]);
  });

  it('drops negative / non-finite custom values', () => {
    expect(calendarReminderLeads(false, [-5, Number.NaN, 15])).toEqual([0, 15, 60]);
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
