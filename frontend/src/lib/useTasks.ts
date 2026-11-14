import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';

export type TaskStatus = 'open' | 'done' | 'dropped';

export interface Task {
  id: string;
  title: string;
  notes?: string;
  dueAt?: string;
  status: TaskStatus;
  priority: number;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    title: str(row.title) ?? '',
    notes: str(row.notes),
    dueAt: str(row.due_at),
    status: (str(row.status) as TaskStatus) ?? 'open',
    priority: typeof row.priority === 'number' ? row.priority : 0,
  };
}

/** Accepts a date (YYYY-MM-DD) or datetime; returns an ISO datetime or undefined. */
function toIso(value?: string): string | undefined {
  if (!value) return undefined;
  const raw = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export interface TasksState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  addTask: (input: { title: string; dueAt?: string; priority?: number; notes?: string }) => Promise<void>;
  toggleTask: (task: Task) => Promise<void>;
  removeTask: (task: Task) => Promise<void>;
}

export function useTasks(): TasksState {
  const configured = isApiConfigured;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState<boolean>(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    api.tasks
      .list()
      .then((rows) => {
        if (!active) return;
        setTasks(rows.map(rowToTask));
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load your tasks.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [configured]);

  const addTask: TasksState['addTask'] = async ({ title, dueAt, priority, notes }) => {
    const clean = title.trim();
    if (!clean) return;
    const optimistic: Task = {
      id: `tmp-${Date.now()}`,
      title: clean,
      dueAt: toIso(dueAt),
      status: 'open',
      priority: priority ?? 0,
      notes,
    };
    if (!configured) {
      setTasks((cur) => [optimistic, ...cur]);
      return;
    }
    const row = await api.tasks.create({
      title: clean,
      ...(toIso(dueAt) ? { due_at: toIso(dueAt) } : {}),
      ...(priority ? { priority } : {}),
      ...(notes ? { notes } : {}),
    });
    setTasks((cur) => [rowToTask(row as Record<string, unknown>), ...cur]);
  };

  const toggleTask: TasksState['toggleTask'] = async (task) => {
    const next: TaskStatus = task.status === 'done' ? 'open' : 'done';
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, status: next } : t)));
    if (configured && !task.id.startsWith('tmp-')) {
      await api.tasks.update(task.id, { status: next }).catch(() => {});
    }
  };

  const removeTask: TasksState['removeTask'] = async (task) => {
    setTasks((cur) => cur.filter((t) => t.id !== task.id));
    if (configured && !task.id.startsWith('tmp-')) {
      await api.tasks.remove(task.id).catch(() => {});
    }
  };

  return { tasks, loading, error, configured, addTask, toggleTask, removeTask };
}
