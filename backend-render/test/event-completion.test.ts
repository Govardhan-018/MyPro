import { describe, it, expect } from 'vitest';
import { completionWindow, isEventEditable } from '../src/calendar/calendar.module';

/**
 * The time rules for a calendar event (Feature: Done + edit lock). The backend
 * is the authority — the UI only mirrors this — so pin it here.
 *
 *  - editable only before it starts;
 *  - done only after it starts, for a 12-hour window (a day for all-day).
 */
const HOUR = 3600_000;

function timedAt(offsetHours: number) {
  // An event whose start is `offsetHours` from "now" (negative = in the past).
  return { starts_at: new Date(Date.now() + offsetHours * HOUR).toISOString(), all_day: false };
}

describe('isEventEditable', () => {
  it('is editable before it starts', () => {
    expect(isEventEditable(timedAt(2))).toBe(true);
  });
  it('is locked once it has started', () => {
    expect(isEventEditable(timedAt(-0.5))).toBe(false);
    expect(isEventEditable(timedAt(-20))).toBe(false);
  });
  it('an all-day event stays editable through its day', () => {
    const now = Date.UTC(2026, 2, 10, 15, 0); // 3pm UTC on the day
    const allDay = { starts_at: '2026-03-10T00:00:00.000Z', all_day: true };
    expect(isEventEditable(allDay, now)).toBe(true);
    // ...but not the next day.
    expect(isEventEditable(allDay, now + 24 * HOUR)).toBe(false);
  });
});

describe('completionWindow', () => {
  it('is closed before the event starts (too early)', () => {
    expect(completionWindow(timedAt(1))).toEqual({ open: false, reason: 'too_early' });
  });
  it('is open just after it starts', () => {
    expect(completionWindow(timedAt(-1)).open).toBe(true);
  });
  it('is open up to 12 hours after the start', () => {
    expect(completionWindow(timedAt(-11)).open).toBe(true);
  });
  it('closes after the 12-hour window (too late)', () => {
    expect(completionWindow(timedAt(-13))).toEqual({ open: false, reason: 'too_late' });
  });
  it('gives an all-day event a full-day window', () => {
    const start = Date.UTC(2026, 2, 10, 0, 0);
    const allDay = { starts_at: '2026-03-10T00:00:00.000Z', all_day: true };
    expect(completionWindow(allDay, start + 20 * HOUR).open).toBe(true);
    expect(completionWindow(allDay, start + 25 * HOUR)).toEqual({ open: false, reason: 'too_late' });
  });
});
