/**
 * The brief, with or without the laptop — Phase 11.3.
 *
 * The notification fires on time because Android armed it locally (11.2). The
 * question this file answers is what the user reads when they tap it.
 *
 * If the laptop was awake at the hour, its drain loop generated a real brief
 * and wrote it out. If it was shut, there is nothing to read — and "nothing"
 * is the failure the whole phase exists to prevent. So the phone composes the
 * plain version from the calendar and tasks it can still reach through render.
 *
 * The generated brief is read from `/notifications`, not from the chat. That
 * is deliberate: the chat lives behind the laptop agent, which is exactly the
 * machine that might be asleep, while notifications are on render. Every
 * generated brief writes a notification row on its way out, so the row is the
 * reachable copy.
 */
import { client } from './client';

export type BriefSource = 'generated' | 'composed';

export interface Brief {
  text: string;
  source: BriefSource;
  /** When the generated brief was written; null for a composed one. */
  at: string | null;
  /** Today's events, so the screen can list them under the prose. */
  events: { title: string; startsAt: string | null; allDay: boolean }[];
  openTasks: number;
}

const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfToday = (): Date => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * Local date key, not `toISOString().slice(0,10)`.
 *
 * The UTC date is a different day for most of the evening east of Greenwich —
 * the same bug that drew calendar events on the wrong day in the web app.
 */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

const todayKey = (): string => localDateKey(new Date().toISOString());

export async function loadBrief(): Promise<Brief> {
  const from = startOfToday();
  const to = endOfToday();

  const [events, tasks, generated] = await Promise.all([
    client.api.calendar
      .events({ from: from.toISOString(), to: to.toISOString() })
      .catch(() => [] as Record<string, unknown>[]),
    client.api.tasks.list('open').catch(() => [] as Record<string, unknown>[]),
    findGeneratedBrief(),
  ]);

  const shaped = events
    .map((row) => ({
      title: typeof row.title === 'string' ? row.title : 'Untitled',
      startsAt: typeof row.starts_at === 'string' ? row.starts_at : null,
      allDay: row.all_day === true,
    }))
    .filter((e) => e.allDay || !e.startsAt || localDateKey(e.startsAt) === todayKey())
    .sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''));

  if (generated) {
    return {
      text: generated.text,
      source: 'generated',
      at: generated.at,
      events: shaped,
      openTasks: tasks.length,
    };
  }

  return {
    text: compose(shaped.length, tasks.length),
    source: 'composed',
    at: null,
    events: shaped,
    openTasks: tasks.length,
  };
}

/**
 * The most recent brief the laptop generated **today**.
 *
 * Yesterday's brief is worse than no brief — it reads as current and is not —
 * so anything outside today is ignored and the plain version wins.
 */
async function findGeneratedBrief(): Promise<{ text: string; at: string } | null> {
  try {
    const rows = await client.api.notifications.list();
    const hit = rows.find(
      (row) =>
        row.kind === 'schedule' &&
        !!row.body &&
        localDateKey(row.created_at) === todayKey(),
    );
    return hit?.body ? { text: hit.body, at: hit.created_at } : null;
  } catch {
    return null;
  }
}

/** The no-AI brief. Short, true, and never pretends to be more than it is. */
function compose(eventCount: number, taskCount: number): string {
  if (!eventCount && !taskCount) return 'Nothing on the calendar today — a clear day.';
  const parts: string[] = [];
  if (eventCount) parts.push(`${eventCount} event${eventCount === 1 ? '' : 's'} today`);
  if (taskCount) parts.push(`${taskCount} open task${taskCount === 1 ? '' : 's'}`);
  return `Here's your day: ${parts.join(' and ')}.`;
}
