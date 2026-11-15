import { DateTime } from 'luxon';
import { parseExpression } from 'cron-parser';

export type Recurrence = 'once' | 'daily' | 'weekly' | 'monthly' | 'cron';

export interface ScheduleShape {
  recurrence: Recurrence;
  run_at?: string | null;
  /** 'HH:mm' or 'HH:mm:ss' */
  time_of_day?: string | null;
  day_of_month?: number | null;
  cron_expr?: string | null;
  timezone: string;
  /** 0 = Sunday … 6 = Saturday */
  days?: number[];
}

function atTime(base: DateTime, timeOfDay: string): DateTime {
  const [h, m, s] = timeOfDay.split(':').map((n) => parseInt(n, 10));
  return base.set({
    hour: h || 0,
    minute: m || 0,
    second: s || 0,
    millisecond: 0,
  });
}

/** Luxon weekday is 1=Mon…7=Sun; we store 0=Sun…6=Sat. */
const toLuxonWeekday = (d: number): number => (d === 0 ? 7 : d);

/**
 * Next UTC instant this schedule should fire after `from`.
 * Returns null when the schedule is finished (a one-shot already past).
 */
export function computeNextRun(s: ScheduleShape, from: Date = new Date()): Date | null {
  const zone = s.timezone || 'UTC';
  const now = DateTime.fromJSDate(from, { zone });

  switch (s.recurrence) {
    case 'once': {
      if (!s.run_at) return null;
      const at = DateTime.fromISO(s.run_at, { zone: 'utc' });
      return at > DateTime.utc() ? at.toJSDate() : null;
    }

    case 'daily': {
      if (!s.time_of_day) return null;
      let next = atTime(now, s.time_of_day);
      if (next <= now) next = next.plus({ days: 1 });
      return next.toUTC().toJSDate();
    }

    case 'weekly': {
      if (!s.time_of_day || !s.days?.length) return null;
      const wanted = [...new Set(s.days)].map(toLuxonWeekday).sort((a, b) => a - b);
      // Look ahead at most a full week.
      for (let offset = 0; offset <= 7; offset++) {
        const day = now.plus({ days: offset });
        if (!wanted.includes(day.weekday)) continue;
        const candidate = atTime(day, s.time_of_day);
        if (candidate > now) return candidate.toUTC().toJSDate();
      }
      return null;
    }

    case 'monthly': {
      if (!s.time_of_day || !s.day_of_month) return null;
      for (let offset = 0; offset <= 12; offset++) {
        const month = now.plus({ months: offset });
        // Clamp (e.g. day 31 in a 30-day month fires on the last day).
        const day = Math.min(s.day_of_month, month.daysInMonth ?? 28);
        const candidate = atTime(month.set({ day }), s.time_of_day);
        if (candidate > now) return candidate.toUTC().toJSDate();
      }
      return null;
    }

    case 'cron': {
      if (!s.cron_expr) return null;
      try {
        const it = parseExpression(s.cron_expr, { currentDate: from, tz: zone });
        return it.next().toDate();
      } catch {
        return null;
      }
    }

    default:
      return null;
  }
}

/**
 * Every time this schedule fires between `from` and `until` (Phase 11.2).
 *
 * The phone is the clock: it registers local notifications for the next ~48
 * hours and re-arms on every launch, so it needs the list of *moments*, not
 * the rule. Expanding here rather than on the device keeps the recurrence
 * maths in one place per backend and keeps luxon and cron-parser out of the
 * Android bundle — the phone stays dumb on purpose.
 *
 * `computeNextRun` is strictly increasing (it only ever returns an instant
 * after the one it was given), so walking it terminates. `cap` is a
 * belt-and-braces guard against a cron like `* * * * *`, which would
 * otherwise produce 2,880 occurrences for a two-day window.
 */
export function expandOccurrences(
  s: ScheduleShape,
  from: Date,
  until: Date,
  cap = 64,
): Date[] {
  const out: Date[] = [];
  let cursor = from;

  for (let i = 0; i < cap; i++) {
    const next = computeNextRun(s, cursor);
    if (!next || next > until) break;
    out.push(next);
    // Guard against a malformed rule that returns the same instant forever.
    if (next.getTime() <= cursor.getTime()) break;
    cursor = next;
  }
  return out;
}
