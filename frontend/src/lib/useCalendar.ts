import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';

export interface CalEvent {
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt?: string;
  allDay: boolean;
  location?: string;
  tone: string;
}

export interface NewEventInput {
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string;
  allDay: boolean;
  location?: string;
}

/* ---- grid geometry (matches the CSS: 640px tall, 64px/hour from 8 AM) ---- */
export const GRID_START_HOUR = 8;
export const GRID_END_HOUR = 18;
const PX_PER_MIN = 64 / 60;
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
  const height = Math.max(26, (Math.max(end, start + 15) - start) * PX_PER_MIN);
  return { top, height };
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
  const ref = row.calendar_categories ?? row.category;
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
  };
}

function combine(date: string, time?: string): string | undefined {
  if (!date) return undefined;
  const t = time && /^\d{2}:\d{2}/.test(time) ? time : '00:00';
  const d = new Date(`${date}T${t}:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const byStart = (a: CalEvent, b: CalEvent) => a.startsAt.localeCompare(b.startsAt);

export interface CalendarState {
  events: CalEvent[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  createEvent: (input: NewEventInput) => Promise<void>;
}

export function useCalendar(): CalendarState {
  const configured = isApiConfigured;
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();
    api.calendar
      .events({ from, to })
      .then((rows) => {
        if (!active) return;
        setEvents(rows.map(rowToEvent).sort(byStart));
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
  }, [configured]);

  const createEvent = async (input: NewEventInput) => {
    const title = input.title.trim();
    if (!title) throw new Error('Give the event a title.');
    const starts_at = combine(input.date, input.allDay ? '00:00' : input.startTime);
    if (!starts_at) throw new Error('Pick a date for the event.');
    const body = clean({
      title,
      starts_at,
      ends_at: input.allDay ? undefined : combine(input.date, input.endTime),
      all_day: input.allDay,
      location: input.location,
    });
    if (!configured) {
      setEvents((cur) =>
        [
          ...cur,
          { id: `tmp-${Date.now()}`, title, startsAt: starts_at, allDay: input.allDay, location: input.location, tone: 'lavender' },
        ].sort(byStart),
      );
      return;
    }
    const row = await api.calendar.createEvent(body);
    setEvents((cur) => [...cur, rowToEvent(row as Record<string, unknown>)].sort(byStart));
  };

  return { events, loading, error, configured, createEvent };
}

/** Group events by their local YYYY-MM-DD. */
export function groupByDate(events: CalEvent[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  for (const ev of events) {
    const key = ev.startsAt.slice(0, 10);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(ev);
    else map.set(key, [ev]);
  }
  return map;
}
