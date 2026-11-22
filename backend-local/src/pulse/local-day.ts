/**
 * When did the user's day start?
 *
 * The Pulse's daily budget is "at most three unprompted messages a day", and
 * a day is a human thing, not a UTC thing. Resetting at UTC midnight meant
 * that for anyone east of Greenwich the budget rolled over mid-evening: three
 * messages before 5:30am IST, three more after. Everything else in the Pulse
 * is timezone-correct, so this was the one seam where a user in India could
 * be messaged six times in one evening.
 *
 * Pure, so it is testable without a clock or a database.
 */

/**
 * Milliseconds since the epoch at the most recent local midnight in
 * `timeZone`. An unknown zone falls back to UTC rather than throwing — a
 * bad timezone string must not stop the companion from speaking.
 *
 * Derived by subtracting the local wall-clock time of day from `nowMs`, so it
 * needs no offset table. On a DST transition day the result can be an hour
 * out, which costs at most one extra message that day.
 */
export function startOfLocalDayMs(nowMs: number, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(nowMs));
  } catch {
    const utc = new Date(nowMs);
    utc.setUTCHours(0, 0, 0, 0);
    return utc.getTime();
  }

  const value = (type: string): number => {
    const found = parts.find((p) => p.type === type)?.value;
    const n = Number(found);
    return Number.isFinite(n) ? n : 0;
  };

  // en-GB reports midnight as hour 24 in some runtimes.
  const hour = value('hour') % 24;
  const elapsed =
    ((hour * 60 + value('minute')) * 60 + value('second')) * 1_000 + (nowMs % 1_000);

  return nowMs - elapsed;
}
