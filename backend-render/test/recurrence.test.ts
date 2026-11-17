import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { computeNextRun, expandOccurrences, type ScheduleShape } from '../src/schedules/recurrence';

/**
 * Phase 12.4 — the recurrence maths. Pure, deterministic once `from` is fixed,
 * and the one piece of logic that exists twice (render + laptop), so a bug here
 * silently desyncs the clock. `backend-local`'s copy of `computeNextRun` is
 * byte-identical and has its own test asserting the same behaviour.
 */

const base = (over: Partial<ScheduleShape>): ScheduleShape => ({
  recurrence: 'daily',
  timezone: 'UTC',
  ...over,
});
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('computeNextRun — once', () => {
  it('returns a future run_at as-is', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const s = base({ recurrence: 'once', run_at: future });
    expect(iso(computeNextRun(s))).toBe(new Date(future).toISOString());
  });

  it('returns null for a one-shot already in the past', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(computeNextRun(base({ recurrence: 'once', run_at: past }))).toBeNull();
  });

  it('returns null when run_at is missing', () => {
    expect(computeNextRun(base({ recurrence: 'once', run_at: null }))).toBeNull();
  });
});

describe('computeNextRun — daily', () => {
  it('fires later today when the time is still ahead', () => {
    const from = new Date('2026-11-17T06:00:00Z');
    const s = base({ recurrence: 'daily', time_of_day: '08:30' });
    expect(iso(computeNextRun(s, from))).toBe('2026-11-17T08:30:00.000Z');
  });

  it('rolls to tomorrow once the time has passed', () => {
    const from = new Date('2026-11-17T09:00:00Z');
    const s = base({ recurrence: 'daily', time_of_day: '08:30' });
    expect(iso(computeNextRun(s, from))).toBe('2026-11-18T08:30:00.000Z');
  });

  it('resolves the local time through the schedule timezone', () => {
    // 08:30 in Asia/Kolkata (UTC+5:30) is 03:00Z.
    const from = new Date('2026-11-17T00:00:00Z');
    const s = base({ recurrence: 'daily', time_of_day: '08:30', timezone: 'Asia/Kolkata' });
    expect(iso(computeNextRun(s, from))).toBe('2026-11-17T03:00:00.000Z');
  });

  it('returns null without a time_of_day', () => {
    expect(computeNextRun(base({ recurrence: 'daily', time_of_day: null }))).toBeNull();
  });
});

describe('computeNextRun — weekly', () => {
  it('lands on the next requested weekday at the requested time', () => {
    const from = new Date('2026-11-17T00:00:00Z'); // a Tuesday
    const s = base({ recurrence: 'weekly', time_of_day: '09:00', days: [1] }); // Monday (0=Sun)
    const next = computeNextRun(s, from);
    const dt = DateTime.fromJSDate(next!, { zone: 'UTC' });
    expect(dt.weekday).toBe(1); // luxon: 1 = Monday
    expect(dt.hour).toBe(9);
    expect(dt > DateTime.fromJSDate(from)).toBe(true);
  });

  it('maps stored Sunday (0) to the right day', () => {
    const from = new Date('2026-11-17T00:00:00Z');
    const s = base({ recurrence: 'weekly', time_of_day: '07:15', days: [0] }); // Sunday
    const dt = DateTime.fromJSDate(computeNextRun(s, from)!, { zone: 'UTC' });
    expect(dt.weekday).toBe(7); // luxon: 7 = Sunday
    expect(dt.toFormat('HH:mm')).toBe('07:15');
  });

  it('returns null without days', () => {
    expect(computeNextRun(base({ recurrence: 'weekly', time_of_day: '09:00', days: [] }))).toBeNull();
  });
});

describe('computeNextRun — monthly', () => {
  it('clamps a day past the end of the month to the last day', () => {
    // Day 31 in November (30 days) fires on the 30th.
    const from = new Date('2026-11-01T00:00:01Z');
    const s = base({ recurrence: 'monthly', time_of_day: '00:00', day_of_month: 31 });
    expect(iso(computeNextRun(s, from))).toBe('2026-11-30T00:00:00.000Z');
  });

  it('returns null without a day_of_month', () => {
    expect(computeNextRun(base({ recurrence: 'monthly', time_of_day: '09:00', day_of_month: null }))).toBeNull();
  });
});

describe('computeNextRun — cron', () => {
  it('returns the next matching instant', () => {
    const from = new Date('2026-11-17T00:00:00Z');
    const s = base({ recurrence: 'cron', cron_expr: '30 8 * * *' });
    expect(iso(computeNextRun(s, from))).toBe('2026-11-17T08:30:00.000Z');
  });

  it('returns null for a malformed cron expression', () => {
    expect(computeNextRun(base({ recurrence: 'cron', cron_expr: 'not a cron' }))).toBeNull();
  });
});

describe('expandOccurrences', () => {
  it('lists every daily firing inside the window', () => {
    const s = base({ recurrence: 'daily', time_of_day: '08:30' });
    const from = new Date('2026-11-17T00:00:00Z');
    const until = new Date('2026-11-19T12:00:00Z');
    const out = expandOccurrences(s, from, until).map(iso);
    expect(out).toEqual([
      '2026-11-17T08:30:00.000Z',
      '2026-11-18T08:30:00.000Z',
      '2026-11-19T08:30:00.000Z',
    ]);
  });

  it('returns nothing when the only occurrence is past the window', () => {
    const s = base({ recurrence: 'once', run_at: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    const from = new Date();
    const until = new Date(Date.now() + 86_400_000); // one day
    expect(expandOccurrences(s, from, until)).toEqual([]);
  });

  it('caps a runaway rule at `cap` occurrences', () => {
    // Every minute for ten days would be ~14k; the cap must hold it down.
    const s = base({ recurrence: 'cron', cron_expr: '* * * * *' });
    const from = new Date('2026-11-17T00:00:00Z');
    const until = new Date('2026-11-27T00:00:00Z');
    expect(expandOccurrences(s, from, until)).toHaveLength(64); // default cap
    expect(expandOccurrences(s, from, until, 10)).toHaveLength(10);
  });
});
