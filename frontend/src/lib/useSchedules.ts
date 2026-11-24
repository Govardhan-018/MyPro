/**
 * The schedules data layer (Roadmap Phase 5).
 *
 * `assistant_schedules` is written from two directions — you, here, and the
 * assistant when it acts on "report me every weekday at 08:30" — so this hook
 * always reads the server's own view rather than keeping a local model.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ScheduleRow } from '@mypro/shared';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';
import { requestShellRearm } from './shell';

export type ScheduleRunRow = {
  id: string;
  ran_at: string;
  status: 'success' | 'failed' | 'skipped' | 'pending_confirmation' | 'retrying' | string;
  detail: string | null;
  /** The AI reply / email subject (migration 0022). */
  result?: string | null;
  attempt?: number;
};

/** The shape `POST /schedules` and `PATCH /schedules/:id` both validate. */
export interface ScheduleInput extends Record<string, unknown> {
  name: string;
  description?: string;
  action_type: ScheduleRow['action_type'];
  action_payload: Record<string, unknown>;
  channel: string;
  recurrence: ScheduleRow['recurrence'];
  run_at?: string;
  time_of_day?: string;
  days?: number[];
  day_of_month?: number;
  cron_expr?: string;
  timezone: string;
  enabled: boolean;
  requires_confirmation: boolean;
}

/**
 * The API validates a *whole* schedule on PATCH, so an edit as small as
 * flipping `enabled` has to send the row back in full. This rebuilds the
 * input from a row so callers can patch one field without losing the rest.
 */
export function rowToInput(row: ScheduleRow): ScheduleInput {
  const input: ScheduleInput = {
    name: row.name,
    action_type: row.action_type,
    action_payload: row.action_payload ?? {},
    channel: row.channel || 'in_app',
    recurrence: row.recurrence,
    timezone: row.timezone || 'UTC',
    enabled: row.enabled,
    requires_confirmation: row.requires_confirmation,
  };
  if (row.description) input.description = row.description;
  if (row.run_at) input.run_at = row.run_at;
  // The API wants HH:MM[:SS]; Postgres hands back HH:MM:SS.
  if (row.time_of_day) input.time_of_day = row.time_of_day.slice(0, 8);
  if (row.day_of_month) input.day_of_month = row.day_of_month;
  if (row.cron_expr) input.cron_expr = row.cron_expr;
  const days = row.assistant_schedule_days?.map((d) => d.day_of_week);
  if (days?.length) input.days = days;
  return input;
}

/* ------------------------------------------------------------------ */
/* The three scheduling modes — the form model and its mapping          */
/* ------------------------------------------------------------------ */

/** The three things a schedule can do, as the form offers them. */
export type ScheduleMode = 'notify' | 'chat_message' | 'email';
export type RepeatMode = 'once' | 'daily' | 'weekly';

export interface ScheduleForm {
  mode: ScheduleMode;
  /** Remind me: what to be reminded about. AI / Email: the instructions. */
  text: string;
  /** Email only: the destination address. */
  to: string;
  /** 'YYYY-MM-DD', local. Used when repeat = once. */
  date: string;
  /** 'HH:MM', local. */
  time: string;
  repeat: RepeatMode;
  /** 0 = Sunday … 6 = Saturday, for repeat = weekly. */
  days: number[];
  /** Email only: draft it, then wait for approval instead of sending. */
  askFirst: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A fresh form: one hour from now, rounded up to the next quarter hour. */
export function emptyScheduleForm(now = new Date()): ScheduleForm {
  const at = new Date(now.getTime() + 60 * 60_000);
  at.setMinutes(Math.ceil(at.getMinutes() / 15) * 15, 0, 0);
  return {
    mode: 'notify',
    text: '',
    to: '',
    date: localDate(at),
    time: localTime(at),
    repeat: 'once',
    days: [1, 2, 3, 4, 5],
    askFirst: false,
  };
}

/** Whether a row can be edited with the three-mode form. */
export function isFormEditable(row: ScheduleRow): boolean {
  return (
    (row.action_type === 'notify' || row.action_type === 'chat_message' || row.action_type === 'email') &&
    (row.recurrence === 'once' || row.recurrence === 'daily' || row.recurrence === 'weekly')
  );
}

/** Rebuild the form from a row, for editing. */
export function formFromRow(row: ScheduleRow, now = new Date()): ScheduleForm {
  const base = emptyScheduleForm(now);
  const p = row.action_payload ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof p[k] === 'string' && (p[k] as string).trim()) return p[k] as string;
    return '';
  };
  const at = row.run_at ? new Date(row.run_at) : null;
  return {
    mode: (['notify', 'chat_message', 'email'] as const).includes(row.action_type as ScheduleMode)
      ? (row.action_type as ScheduleMode)
      : 'notify',
    text:
      row.action_type === 'notify'
        ? pick('body', 'message', 'text', 'prompt') || row.name
        : pick('prompt', 'text', 'instructions'),
    to: pick('to'),
    date: at && Number.isFinite(at.getTime()) ? localDate(at) : base.date,
    time: at && Number.isFinite(at.getTime()) ? localTime(at) : (row.time_of_day?.slice(0, 5) ?? base.time),
    repeat: (row.recurrence === 'daily' || row.recurrence === 'weekly' ? row.recurrence : 'once') as RepeatMode,
    days: row.assistant_schedule_days?.map((d) => d.day_of_week).sort((a, b) => a - b) ?? base.days,
    askFirst: row.action_type === 'email' ? row.requires_confirmation : false,
  };
}

/**
 * Turn the form into what the API validates — or say what is missing. Pure,
 * so every rule is unit-tested; the server re-checks the same rules.
 */
export function buildScheduleInput(
  form: ScheduleForm,
  timezone: string,
  now = new Date(),
): { input: ScheduleInput } | { error: string; field: 'text' | 'to' | 'when' | 'days' } {
  const text = form.text.trim();
  if (!text) {
    return {
      field: 'text',
      error:
        form.mode === 'notify'
          ? 'Say what you want to be reminded about.'
          : form.mode === 'chat_message'
            ? 'Describe what the AI should do.'
            : 'Describe what the email should say.',
    };
  }
  const to = form.to.trim();
  if (form.mode === 'email' && !EMAIL_RE.test(to)) {
    return { field: 'to', error: 'Enter a valid email address to send to.' };
  }
  if (!/^\d{2}:\d{2}$/.test(form.time)) return { field: 'when', error: 'Choose a time.' };
  if (form.repeat === 'weekly' && !form.days.length) {
    return { field: 'days', error: 'Pick at least one day.' };
  }

  let runAt: string | undefined;
  if (form.repeat === 'once') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return { field: 'when', error: 'Choose a date.' };
    // Parsed as *local* time — the zone the user is looking at.
    const at = new Date(`${form.date}T${form.time}:00`);
    if (!Number.isFinite(at.getTime())) return { field: 'when', error: 'That date or time is not valid.' };
    if (at.getTime() <= now.getTime()) {
      return { field: 'when', error: 'That time has already passed — pick a time in the future.' };
    }
    runAt = at.toISOString();
  }

  const short = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
  const name =
    form.mode === 'email' ? short(`Email to ${to}`, 120) : short(text.replace(/\s+/g, ' '), 120);
  const action_payload: Record<string, unknown> =
    form.mode === 'notify'
      ? { title: 'Reminder', body: text }
      : form.mode === 'chat_message'
        ? { prompt: text }
        : { to, prompt: text };

  const input: ScheduleInput = {
    name,
    action_type: form.mode,
    action_payload,
    channel: form.mode === 'email' ? 'email' : 'push',
    recurrence: form.repeat,
    timezone,
    enabled: true,
    // Only an email can be held for approval; a reminder or an AI reply in
    // your own chat has nothing outward to approve.
    requires_confirmation: form.mode === 'email' ? form.askFirst : false,
  };
  if (runAt) input.run_at = runAt;
  else input.time_of_day = form.time;
  if (form.repeat === 'weekly') input.days = [...new Set(form.days)].sort((a, b) => a - b);
  return { input };
}

function message(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

export interface SchedulesState {
  items: ScheduleRow[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  reload: () => void;
  create: (input: ScheduleInput) => Promise<void>;
  update: (id: string, input: ScheduleInput) => Promise<void>;
  setEnabled: (row: ScheduleRow, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  runs: (id: string) => Promise<ScheduleRunRow[]>;
}

export function useSchedules(enabled: boolean): SchedulesState {
  const configured = isApiConfigured;
  const active = configured && enabled;
  const [items, setItems] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState<boolean>(active);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!active) return;
    setError(null);
    try {
      setItems(await api.schedules.list());
    } catch (caught) {
      setError(message(caught, 'Could not load your schedules.'));
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active) {
      setLoading(false);
      return;
    }
    void load();
    // A run just happened (its notification arrived), or the app came back to
    // the foreground: statuses may have moved on.
    const refresh = () => void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('mypro:schedules-updated', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('mypro:schedules-updated', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, load]);

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await work();
      // A reminder created/edited/removed must reach the phone's clock now,
      // not on its next launch — or a reminder set for ten minutes from now,
      // with the app then closed, never fires.
      requestShellRearm();
      await load();
    } catch (caught) {
      setError(message(caught, fallback));
      throw caught;
    }
  };

  return {
    items,
    loading,
    error,
    configured,
    reload: () => void load(),
    create: (input) => run(() => api.schedules.create(input), 'Could not create that schedule.'),
    update: (id, input) =>
      run(() => api.schedules.update(id, input), 'Could not update that schedule.'),
    setEnabled: (row, next) =>
      run(
        () => api.schedules.update(row.id, { ...rowToInput(row), enabled: next }),
        'Could not change that schedule.',
      ),
    remove: (id) => run(() => api.schedules.remove(id), 'Could not delete that schedule.'),
    runs: async (id) => (await api.schedules.runs(id)) as ScheduleRunRow[],
  };
}
