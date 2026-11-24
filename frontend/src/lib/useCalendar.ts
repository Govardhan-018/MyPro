import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';
import { requestShellRearm } from './shell';

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

export interface NewEventInput {
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string;
  allDay: boolean;
  location?: string;
}

/* ---- grid geometry ----------------------------------------------------
 * The grid covers the whole day at 64px/hour and scrolls inside a 640px
 * window. It used to run 8 AM–6 PM with `overflow: hidden`, which silently
 * ate every event outside office hours — an 8 PM dinner simply was not
 * drawn, and a 6 AM run was clamped on top of the 8 AM slot.
 * -------------------------------------------------------------------- */
export const GRID_START_HOUR = 0;
export const GRID_END_HOUR = 24;
const PX_PER_HOUR = 64;
const PX_PER_MIN = PX_PER_HOUR / 60;
/** Full height of the scrollable day (24 × 64). */
export const GRID_HEIGHT = (GRID_END_HOUR - GRID_START_HOUR) * PX_PER_HOUR;
/** Where the grid parks itself when opened — the working day, as before. */
export const DEFAULT_SCROLL_TOP = 8 * PX_PER_HOUR;

export const HOUR_LABELS = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => {
  const h = GRID_START_HOUR + i;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const base = h % 12 === 0 ? 12 : h % 12;
  return `${base} ${suffix}`;
});

const WEEKDAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const TONES = ['lavender', 'mint', 'blue', 'peach', 'cyan', 'coral'];

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - weekday);
  return d;
}

export function weekdayLabel(d: Date): string {
  return WEEKDAY_LABELS[(d.getDay() + 6) % 7];
}

function minutesInto(iso: string): number {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 0 : d.getHours() * 60 + d.getMinutes();
}

export function positionOf(ev: CalEvent): { top: number; height: number } {
  const start = minutesInto(ev.startsAt);
  const end = ev.endsAt ? minutesInto(ev.endsAt) : start + 60;
  const top = Math.max(0, (start - GRID_START_HOUR * 60) * PX_PER_MIN);
  // An event ending before it starts (or crossing midnight) still has to be
  // drawable: clamp to the end of the day rather than render a negative box.
  const span = end > start ? end - start : Math.max(15, 24 * 60 - start);
  // `span` is minutes and `GRID_HEIGHT - top` is pixels: comparing them before
  // the conversion clamped a late-evening event against the wrong unit, so it
  // still spilled past the bottom of the grid.
  return { top, height: Math.max(26, Math.min(span * PX_PER_MIN, GRID_HEIGHT - top)) };
}

export function nowOffset(): number {
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes() - GRID_START_HOUR * 60) * PX_PER_MIN;
}

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

function rowToEvent(row: Record<string, unknown>): CalEvent {
  const id = String(row.id);
  return {
    id,
    title: str(row.title) ?? '(untitled)',
    startsAt: str(row.starts_at) ?? '',
    endsAt: str(row.ends_at),
    allDay: Boolean(row.all_day),
    location: str(row.location),
    tone: toneFor(row, id),
    completedAt: str(row.completed_at),
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

  /** Shared validation + shaping for create and update. */
  const toBody = (input: NewEventInput): Record<string, unknown> => {
    const title = input.title.trim();
    if (!title) throw new Error('Give the event a title.');
    const starts_at = combine(input.date, input.startTime, input.allDay);
    if (!starts_at) throw new Error('Pick a date for the event.');
    const ends_at = input.allDay ? undefined : combine(input.date, input.endTime);
    if (ends_at && new Date(ends_at) <= new Date(starts_at)) {
      throw new Error('The end time has to be after the start time.');
    }
    return clean({
      title,
      starts_at,
      ends_at,
      all_day: input.allDay,
      location: input.location,
    });
  };

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
            tone: 'lavender',
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
    // An unset end time has to be sent explicitly, or the old one survives.
    if (!('ends_at' in body)) body.ends_at = null;
    if (!('location' in body)) body.location = null;
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
