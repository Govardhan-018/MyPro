import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { computeNextRun, type ScheduleShape } from '../src/schedules/recurrence';

/**
 * Phase 12.4 — the laptop's copy of the recurrence maths. This file is a
 * deliberate byte-for-byte copy of render's `computeNextRun` (it owns the drain
 * loop; render's copy validates and arms on write). The rule is "change one,
 * change both" — this test is what catches a change that landed in only one.
 * It mirrors the render suite's computeNextRun cases exactly.
 */

const base = (over: Partial<ScheduleShape>): ScheduleShape => ({
  recurrence: 'daily',
  timezone: 'UTC',
  ...over,
});
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('computeNextRun (backend-local copy)', () => {
  it('once: future run_at as-is, past -> null', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(iso(computeNextRun(base({ recurrence: 'once', run_at: future })))).toBe(
      new Date(future).toISOString(),
    );
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(computeNextRun(base({ recurrence: 'once', run_at: past }))).toBeNull();
  });

  it('daily: later today, else tomorrow', () => {
    const s = base({ recurrence: 'daily', time_of_day: '08:30' });
    expect(iso(computeNextRun(s, new Date('2026-11-17T06:00:00Z')))).toBe('2026-11-17T08:30:00.000Z');
    expect(iso(computeNextRun(s, new Date('2026-11-17T09:00:00Z')))).toBe('2026-11-18T08:30:00.000Z');
  });

  it('daily: resolves through the schedule timezone', () => {
    const s = base({ recurrence: 'daily', time_of_day: '08:30', timezone: 'Asia/Kolkata' });
    expect(iso(computeNextRun(s, new Date('2026-11-17T00:00:00Z')))).toBe('2026-11-17T03:00:00.000Z');
  });

  it('weekly: next requested weekday at the requested time', () => {
    const from = new Date('2026-11-17T00:00:00Z');
    const dt = DateTime.fromJSDate(
      computeNextRun(base({ recurrence: 'weekly', time_of_day: '09:00', days: [1] }), from)!,
      { zone: 'UTC' },
    );
    expect(dt.weekday).toBe(1);
    expect(dt.hour).toBe(9);
  });

  it('monthly: clamps day 31 to the last day of a 30-day month', () => {
    const s = base({ recurrence: 'monthly', time_of_day: '00:00', day_of_month: 31 });
    expect(iso(computeNextRun(s, new Date('2026-11-01T00:00:01Z')))).toBe('2026-11-30T00:00:00.000Z');
  });

  it('cron: next matching instant, null on garbage', () => {
    expect(iso(computeNextRun(base({ recurrence: 'cron', cron_expr: '30 8 * * *' }), new Date('2026-11-17T00:00:00Z')))).toBe(
      '2026-11-17T08:30:00.000Z',
    );
    expect(computeNextRun(base({ recurrence: 'cron', cron_expr: 'not a cron' }))).toBeNull();
  });
});
