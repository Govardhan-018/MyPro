import { describe, it, expect } from 'vitest';
import { startOfLocalDayMs } from '../src/pulse/local-day';

/**
 * Phase 19 — the Pulse's daily budget resets on the user's day.
 *
 * It used to reset at UTC midnight, which for a user in India meant the
 * three-message budget rolled over at 05:30 local: three messages in the
 * morning, three more the same evening. This is a single-person system and
 * that person is in IST, so the defect was guaranteed to fire.
 */

const HOUR = 3_600_000;

describe('startOfLocalDayMs', () => {
  it('matches UTC midnight for UTC', () => {
    const now = Date.parse('2026-03-15T13:45:30.250Z');
    expect(new Date(startOfLocalDayMs(now, 'UTC')).toISOString()).toBe(
      '2026-03-15T00:00:00.000Z',
    );
  });

  it('is 18:30 UTC the previous day for IST', () => {
    // 09:00 IST on 15 March = 03:30 UTC. The local day began at 18:30 UTC on the 14th.
    const now = Date.parse('2026-03-15T03:30:00.000Z');
    expect(new Date(startOfLocalDayMs(now, 'Asia/Kolkata')).toISOString()).toBe(
      '2026-03-14T18:30:00.000Z',
    );
  });

  it('does not roll over mid-evening in IST — the actual defect', () => {
    const morning = Date.parse('2026-03-15T04:00:00.000Z'); // 09:30 IST
    const evening = Date.parse('2026-03-15T15:00:00.000Z'); // 20:30 IST same day
    expect(startOfLocalDayMs(morning, 'Asia/Kolkata')).toBe(
      startOfLocalDayMs(evening, 'Asia/Kolkata'),
    );
    // ...whereas the UTC day does roll over between those two instants
    const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    expect(utcDay(morning)).toBe(utcDay(evening));
  });

  it('handles a negative offset', () => {
    // 20:00 on 14 March in New York = 00:00 UTC on the 15th; local day began 05:00 UTC on the 14th.
    const now = Date.parse('2026-03-15T00:00:00.000Z');
    expect(new Date(startOfLocalDayMs(now, 'America/New_York')).toISOString()).toBe(
      '2026-03-14T04:00:00.000Z',
    );
  });

  it('is at or before now, and never more than 24h back', () => {
    const now = Date.parse('2026-07-01T11:11:11.111Z');
    for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Pacific/Kiritimati']) {
      const start = startOfLocalDayMs(now, tz);
      expect(start).toBeLessThanOrEqual(now);
      expect(now - start).toBeLessThan(24 * HOUR);
    }
  });

  it('is exactly local midnight at local midnight', () => {
    const now = Date.parse('2026-03-14T18:30:00.000Z'); // 00:00 IST on the 15th
    expect(startOfLocalDayMs(now, 'Asia/Kolkata')).toBe(now);
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    const now = Date.parse('2026-03-15T13:45:30.250Z');
    expect(startOfLocalDayMs(now, 'Mars/Olympus_Mons')).toBe(
      Date.parse('2026-03-15T00:00:00.000Z'),
    );
  });
});
