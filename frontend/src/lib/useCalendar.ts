import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';
import { requestShellRearm } from './shell';

/** One store, two kinds: an appointment, or a nudge at a moment (0025). */
export type CalKind = 'event' | 'reminder';

/**
 * Anything with a time on the calendar. Most are `calendar_events` rows; a
 * one-off "Remind me" from Schedules is mapped into the same shape (`source:
 * 'schedule'`, see useAgenda) so the month, the day panel and Today's Flow all
 * read one list.
 */
export interface CalEvent {
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt?: string;
  allDay: boolean;
  location?: string;
  tone: string;
  /** Set once the event has been marked done. */
  completedAt?: string;
  /** Defaults to 'event' (every row before 0025). */
  kind?: CalKind;
  /** A reminder's note (`description`). */
  note?: string;
  /** The chosen "Remind before", in minutes; null/undefined = the default. */
  leadMinutes?: number | null;
  /** Where the row lives. Defaults to 'calendar'. */
  source?: 'calendar' | 'schedule';
  /** The Schedules row id, for `source: 'schedule'`. */
  scheduleId?: string;
  /** A Schedules reminder that is switched off. */
  paused?: boolean;
}

/** "Remind before" choices, in minutes. `0` = at the time itself. */
export const LEAD_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'At time of event' },
  { minutes: 5, label: '5 mins before' },
  { minutes: 15, label: '15 mins before' },
  { minutes: 30, label: '30 mins before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
];

/** An all-day item has no time to count back from: morning of, or the day before. */
export const ALL_DAY_LEAD_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'Morning of (9 AM)' },
  { minutes: 1440, label: '1 day before (9 AM)' },
];

/**
 * The lead an item effectively has. A row with no reminder of its own keeps
 * render's baseline — an event one hour before (and at the start), a reminder
 * at its time — so the editor shows what will actually happen.
 */
export function effectiveLead(ev: Pick<CalEvent, 'leadMinutes' | 'kind' | 'allDay'>): number {
  if (ev.leadMinutes != null) return ev.allDay && ev.leadMinutes % 1440 !== 0 ? 0 : ev.leadMinutes;
  return ev.kind === 'reminder' || ev.allDay ? 0 : 60;
}

/** "15 min before", "1 day before", "At time" — the chip beside an item. */
export function leadLabel(minutes: number, allDay = false): string {
  if (allDay) return minutes >= 1440 ? `${minutes / 1440 === 1 ? '1 day' : `${minutes / 1440} days`} before` : 'Morning of';
  if (minutes <= 0) return 'At time';
  if (minutes % 1440 === 0) return `${minutes / 1440 === 1 ? '1 day' : `${minutes / 1440} days`} before`;
  if (minutes % 60 === 0) return `${minutes / 60 === 1 ? '1 hr' : `${minutes / 60} hr`} before`;
  return `${minutes} min before`;
}

/**
 * When the notification goes off: `remindAt = start − lead`. An all-day item is
 * anchored to 09:00 local on its date (render's `calendarReminderMoments`
 * does the same for the phone's clock — change one, change both).
 */
export function remindAt(ev: Pick<CalEvent, 'startsAt' | 'allDay' | 'leadMinutes' | 'kind'>): Date | null {
  const lead = effectiveLead(ev);
  if (ev.allDay) {
    const [y, m, d] = ev.startsAt.slice(0, 10).split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d - Math.floor(lead / 1440), 9, 0, 0, 0);
  }
  const start = new Date(ev.startsAt).getTime();
  return Number.isFinite(start) ? new Date(start - lead * 60_000) : null;
}

/**
 * The time-based rules for an event's actions. The backend is the authority
 * (backend-render calendar service `completionWindow` / `isEventEditable`);
 * this mirrors it so the UI can hide buttons rather than offer ones the server
 * will refuse. **Change one, change both.**
 *
 *  - `editable`  — only before it starts (an all-day event through its day).
 *  - `canComplete` — once it has started, for a 12-hour window (a day, all-day).
 */
const DONE_WINDOW_MS = 12 * 60 * 60_000;
const DONE_WINDOW_ALL_DAY_MS = 24 * 60 * 60_000;

export interface EventActionState {
  editable: boolean;
  canComplete: boolean;
  completed: boolean;
  /** The completion window has opened and closed without being used. */
  completionMissed: boolean;
}

export function eventActionState(ev: CalEvent, now: number = Date.now()): EventActionState {
  const start = new Date(ev.startsAt).getTime();
  const completed = Boolean(ev.completedAt);
  if (!Number.isFinite(start)) {
    return { editable: true, canComplete: false, completed, completionMissed: false };
  }
  const windowMs = ev.allDay ? DONE_WINDOW_ALL_DAY_MS : DONE_WINDOW_MS;
  const editable = now < start + (ev.allDay ? DONE_WINDOW_ALL_DAY_MS : 0);
  const started = now >= start;
  const canComplete = started && now <= start + windowMs;
  return {
    editable,
    canComplete,
    completed,
    completionMissed: !completed && started && now > start + windowMs,
  };
}

/**
 * Where an event sits in time, for its label: not started, happening now, or
 * over. An event without an end counts as live for an hour (all-day: its day).
 */
export function eventPhaseOf(ev: CalEvent, now: number = Date.now()): 'upcoming' | 'live' | 'ended' {
  const start = new Date(ev.startsAt).getTime();
  if (!Number.isFinite(start) || now < start) return 'upcoming';
  const endParsed = ev.endsAt ? new Date(ev.endsAt).getTime() : NaN;
  const end = Number.isFinite(endParsed)
    ? endParsed
    : start + (ev.allDay ? DONE_WINDOW_ALL_DAY_MS : 60 * 60_000);
  return now < end ? 'live' : 'ended';
}

/** "Tue 24 Nov · 11:55 – 11:58", in the viewer's own time zone. */
export function describeEventTime(ev: CalEvent): string {
  const start = new Date(ev.startsAt);
  if (Number.isNaN(start.getTime())) return '—';
  const day = start.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (ev.allDay) return `${day} · All day`;
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const end = ev.endsAt ? new Date(ev.endsAt) : null;
  return end && !Number.isNaN(end.getTime()) ? `${day} · ${time(start)} – ${time(end)}` : `${day} · ${time(start)}`;
}

export interface NewEventInput {
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string;
  allDay: boolean;
  location?: string;
  /** Defaults to 'event'. */
  kind?: CalKind;
  /** A reminder's note. */
  note?: string;
  /** "Remind before", minutes. Undefined leaves the server's default. */
  leadMinutes?: number;
}

const TONES = ['lavender', 'mint', 'blue', 'peach', 'cyan', 'coral'];

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function durationLabel(ev: CalEvent): string {
  if (ev.allDay) return 'All day';
  const start = new Date(ev.startsAt).getTime();
  const end = ev.endsAt ? new Date(ev.endsAt).getTime() : start + 60 * 60 * 1000;
  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function eventMeta(ev: CalEvent): string {
  if (ev.allDay) return 'All day';
  return `${timeLabel(ev.startsAt)} · ${durationLabel(ev)}`;
}

/* ---- API mapping ---- */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

function toneFor(row: Record<string, unknown>, id: string): string {
  // The API embeds the category as `event_categories(name, tone)`.
  const ref = row.event_categories ?? row.calendar_categories ?? row.category;
  const obj = (Array.isArray(ref) ? ref[0] : ref) as Record<string, unknown> | undefined;
  const tone = str(obj?.tone);
  if (tone && TONES.includes(tone)) return tone;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % 4]; // lavender/mint/blue/peach
}

/** Reminders share one colour so they read apart from events at a glance. */
export const REMINDER_TONE = 'cyan';

export function rowToEvent(row: Record<string, unknown>): CalEvent {
  const id = String(row.id);
  const kind: CalKind = row.kind === 'reminder' ? 'reminder' : 'event';
  const leads = (Array.isArray(row.event_reminders) ? row.event_reminders : [])
    .map((r) => Number((r as Record<string, unknown>)?.minutes_before))
    .filter((m) => Number.isFinite(m) && m >= 0);
  // The row stores the moment itself (0) next to the chosen lead; the chosen
  // one is the largest.
  const lead = leads.length ? Math.max(...leads) : null;
  return {
    id,
    title: str(row.title) ?? '(untitled)',
    startsAt: str(row.starts_at) ?? '',
    endsAt: str(row.ends_at),
    allDay: Boolean(row.all_day),
    location: str(row.location),
    tone: kind === 'reminder' ? REMINDER_TONE : toneFor(row, id),
    completedAt: str(row.completed_at),
    kind,
    note: str(row.description),
    leadMinutes: lead,
    source: 'calendar',
  };
}

function combine(date: string, time?: string, allDay = false): string | undefined {
  if (!date) return undefined;
  if (allDay) {
    /*
     * An all-day event is a *date*, not an instant, and `dateKeyOf` reads it
     * back as `startsAt.slice(0, 10)` — the UTC date.
     *
     * Building it from local midnight therefore put every all-day event one
     * day early for anyone east of Greenwich: 00:00 on the 16th in IST is
     * 18:30 on the 15th in UTC, and the slice said the 15th. Storing UTC
     * midnight makes the stored day and the displayed day the same
     * everywhere.
     */
    return `${date}T00:00:00.000Z`;
  }
  const t = time && /^\d{2}:\d{2}/.test(time) ? time : '00:00';
  const d = new Date(`${date}T${t}:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const byStart = (a: CalEvent, b: CalEvent) => a.startsAt.localeCompare(b.startsAt);

/**
 * Validate the Quick Add form and shape the API body — create and update
 * alike. Pure and exported, so the rules are tested without a network.
 *
 * Kind decides the optional text: an event keeps a location, a reminder a
 * note (`description`). The lead goes out as `reminders`, which the server
 * *replaces*, so an edit that changes the lead never stacks a second one.
 */
export function eventBody(input: NewEventInput): Record<string, unknown> {
  const kind: CalKind = input.kind ?? 'event';
  const noun = kind === 'reminder' ? 'reminder' : 'event';
  const title = input.title.trim();
  if (!title) throw new Error(`Give the ${noun} a title.`);
  if (!input.allDay && !(input.startTime && /^\d{2}:\d{2}/.test(input.startTime))) {
    throw new Error(`Pick a time for the ${noun}, or make it all day.`);
  }
  const starts_at = combine(input.date, input.startTime, input.allDay);
  if (!starts_at) throw new Error(`Pick a date for the ${noun}.`);
  const ends_at = input.allDay || kind === 'reminder' ? undefined : combine(input.date, input.endTime);
  if (ends_at && new Date(ends_at) <= new Date(starts_at)) {
    throw new Error('The end time has to be after the start time.');
  }
  const lead = input.leadMinutes;
  const body = clean({
    title,
    starts_at,
    ends_at,
    all_day: input.allDay,
    location: kind === 'event' ? input.location?.trim() : undefined,
    description: kind === 'reminder' ? input.note?.trim() : undefined,
    kind,
  });
  if (lead != null && Number.isFinite(lead) && lead >= 0) {
    // An all-day item only moves by whole days (render collapses the rest).
    const minutes = input.allDay ? Math.floor(lead / 1440) * 1440 : Math.round(lead);
    body.reminders = [{ minutes_before: minutes, channel: 'push' }];
  }
  return body;
}

/**
 * The day an event belongs to, as the grid keys days (local YYYY-MM-DD).
 *
 * Timed events are converted from their stored UTC instant into *this*
 * device's day — slicing the ISO string instead (the old behaviour) returned
 * the UTC day, so in any non-UTC zone events near the date boundary were
 * drawn a day off. An all-day event has no instant to localise: it is pinned
 * to the calendar date it was stored as, read in UTC.
 */
export function dateKeyOf(ev: CalEvent): string {
  if (!ev.startsAt) return '';
  if (ev.allDay) return ev.startsAt.slice(0, 10);
  const d = new Date(ev.startsAt);
  return Number.isNaN(d.getTime()) ? ev.startsAt.slice(0, 10) : isoDate(d);
}

/** An event's local start time, in the shape an <input type="time"> wants. */
export function timeInputValue(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The months to keep loaded around the date being viewed. */
function windowAround(focus: Date): { from: string; to: string; key: string } {
  const from = new Date(focus.getFullYear(), focus.getMonth() - 1, 1);
  const to = new Date(focus.getFullYear(), focus.getMonth() + 2, 0, 23, 59, 59, 999);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    key: `${focus.getFullYear()}-${focus.getMonth()}`,
  };
}

export interface EventPatch {
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  location?: string;
}

export interface CalendarState {
  events: CalEvent[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  createEvent: (input: NewEventInput) => Promise<void>;
  updateEvent: (id: string, input: NewEventInput) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  completeEvent: (id: string) => Promise<void>;
  uncompleteEvent: (id: string) => Promise<void>;
  reload: () => void;
}

/**
 * Loads the events around `focus` and reloads whenever you page to another
 * month. The window used to be computed once from *today*, so navigating
 * beyond a month either way showed an empty calendar — the data was simply
 * never requested.
 */
export function useCalendar(focus: Date): CalendarState {
  const configured = isApiConfigured;
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(configured);
  const [error, setError] = useState<string | null>(null);
  const { from, to, key } = windowAround(focus);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api.calendar
      .events({ from, to })
      .then((rows) => {
        if (!active) return;
        setEvents(rows.map(rowToEvent).sort(byStart));
        setError(null);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load your calendar.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // `key` is the month being viewed: panning within a month reuses the data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, key, reloadToken]);

  const toBody = eventBody;

  const createEvent = async (input: NewEventInput) => {
    const body = toBody(input);
    if (!configured) {
      setEvents((cur) =>
        [
          ...cur,
          {
            id: `tmp-${Date.now()}`,
            title: String(body.title),
            startsAt: String(body.starts_at),
            endsAt: body.ends_at ? String(body.ends_at) : undefined,
            allDay: input.allDay,
            location: input.location,
            tone: input.kind === 'reminder' ? REMINDER_TONE : 'lavender',
            kind: input.kind ?? 'event',
            note: input.note,
            leadMinutes: input.leadMinutes ?? null,
          },
        ].sort(byStart),
      );
      return;
    }
    const row = await api.calendar.createEvent(body);
    setEvents((cur) => [...cur, rowToEvent(row as Record<string, unknown>)].sort(byStart));
    // Its reminders (1h before, at start) belong on the phone's clock now.
    requestShellRearm();
  };

  const updateEvent = async (id: string, input: NewEventInput) => {
    const body = toBody(input);
    // An unset field has to be sent explicitly, or the old value survives.
    if (!('ends_at' in body)) body.ends_at = null;
    if (!('location' in body)) body.location = null;
    if (!('description' in body)) body.description = null;
    if (!configured) {
      setEvents((cur) =>
        cur
          .map((ev) =>
            ev.id === id
              ? {
                  ...ev,
                  title: String(body.title),
                  startsAt: String(body.starts_at),
                  endsAt: body.ends_at ? String(body.ends_at) : undefined,
                  allDay: input.allDay,
                  location: input.location,
                  kind: input.kind ?? ev.kind,
                  note: input.note,
                  leadMinutes: input.leadMinutes ?? ev.leadMinutes,
                }
              : ev,
          )
          .sort(byStart),
      );
      return;
    }
    const row = await api.calendar.updateEvent(id, body);
    setEvents((cur) =>
      cur.map((ev) => (ev.id === id ? rowToEvent(row as Record<string, unknown>) : ev)).sort(byStart),
    );
    requestShellRearm();
  };

  const deleteEvent = async (id: string) => {
    if (configured) await api.calendar.deleteEvent(id);
    setEvents((cur) => cur.filter((ev) => ev.id !== id));
    // A deleted event's reminders must not fire.
    if (configured) requestShellRearm();
  };

  const setCompletion = (id: string, completedAt: string | undefined) =>
    setEvents((cur) => cur.map((ev) => (ev.id === id ? { ...ev, completedAt } : ev)));

  const completeEvent = async (id: string) => {
    if (!configured) {
      setCompletion(id, new Date().toISOString());
      return;
    }
    const row = await api.calendar.completeEvent(id);
    setEvents((cur) =>
      cur.map((ev) => (ev.id === id ? rowToEvent(row as Record<string, unknown>) : ev)),
    );
  };

  const uncompleteEvent = async (id: string) => {
    if (!configured) {
      setCompletion(id, undefined);
      return;
    }
    const row = await api.calendar.uncompleteEvent(id);
    // DELETE returns no body; fall back to clearing the flag locally.
    setEvents((cur) =>
      cur.map((ev) =>
        ev.id === id
          ? row && typeof row === 'object'
            ? rowToEvent(row as Record<string, unknown>)
            : { ...ev, completedAt: undefined }
          : ev,
      ),
    );
  };

  return {
    events,
    loading,
    error,
    configured,
    createEvent,
    updateEvent,
    deleteEvent,
    completeEvent,
    uncompleteEvent,
    reload: useCallback(() => setReloadToken((t) => t + 1), []),
  };
}

/** Group events by the local day they fall on. */
export function groupByDate(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const key = dateKeyOf(ev);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(ev);
    else map.set(key, [ev]);
  }
  return map;
}
