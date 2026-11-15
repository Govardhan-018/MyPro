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

export type ScheduleRunRow = {
  id: string;
  ran_at: string;
  status: 'success' | 'failed' | 'skipped' | 'pending_confirmation' | string;
  detail: string | null;
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
  }, [active, load]);

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await work();
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
