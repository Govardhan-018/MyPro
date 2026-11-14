import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  allDay: boolean;
  location?: string;
  categoryName?: string;
  categoryTone?: string;
}

export interface NewEventInput {
  title: string;
  date: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  location?: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function clean(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') out[k] = v;
  return out;
}

function category(row: Record<string, unknown>): { name?: string; tone?: string } {
  const ref = row.calendar_categories ?? row.category;
  if (!ref) return {};
  const obj = (Array.isArray(ref) ? ref[0] : ref) as Record<string, unknown> | undefined;
  return { name: str(obj?.name), tone: str(obj?.tone) };
}

function rowToEvent(row: Record<string, unknown>): CalendarEvent {
  const cat = category(row);
  return {
    id: String(row.id),
    title: str(row.title) ?? '(untitled)',
    startsAt: str(row.starts_at) ?? '',
    endsAt: str(row.ends_at),
    allDay: Boolean(row.all_day),
    location: str(row.location),
    categoryName: cat.name,
    categoryTone: cat.tone,
  };
}

function combine(date: string, time?: string): string | undefined {
  if (!date) return undefined;
  const t = time && /^\d{2}:\d{2}/.test(time) ? time : '00:00';
  const d = new Date(`${date}T${t}:00`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const byStart = (a: CalendarEvent, b: CalendarEvent) => a.startsAt.localeCompare(b.startsAt);

export interface CalendarState {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  createEvent: (input: NewEventInput) => Promise<void>;
}

/** Loads events from today forward and persists new ones to /calendar/events. */
export function useCalendar(): CalendarState {
  const configured = isApiConfigured;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const to = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
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
          { id: `tmp-${Date.now()}`, title, startsAt: starts_at, allDay: input.allDay, location: input.location },
        ].sort(byStart),
      );
      return;
    }
    const row = await api.calendar.createEvent(body);
    setEvents((cur) => [...cur, rowToEvent(row as Record<string, unknown>)].sort(byStart));
  };

  return { events, loading, error, configured, createEvent };
}
