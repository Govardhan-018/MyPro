/**
 * In-app notifications (Roadmap Phase 6.1).
 *
 * Reads the history from `/notifications` and then stays live over Supabase
 * Realtime, so anything any node writes — the scheduler on Render, the laptop
 * agent — surfaces as a toast while the app is open. No push infrastructure is
 * involved; that is still Phase 6.2/8.4.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createNotificationStream,
  type NotificationRow,
  type RealtimeState,
} from '@mypro/shared';
import { api } from './api';
import { isApiConfigured } from './env';
import { getAccessToken } from './supabase';

const TOAST_MS = 7000;
/** More than this at once and we would be stacking, not informing. */
const MAX_TOASTS = 3;

export interface NotificationsState {
  items: NotificationRow[];
  unread: number;
  /** Whether the live socket is up — shown as a quiet dot, not an alarm. */
  live: RealtimeState;
  /** Currently-visible toasts, newest last. */
  toasts: NotificationRow[];
  dismiss: (id: string) => void;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  reload: () => void;
}

export function useNotifications(enabled: boolean): NotificationsState {
  const active = isApiConfigured && enabled;
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [toasts, setToasts] = useState<NotificationRow[]>([]);
  const [live, setLive] = useState<RealtimeState>('offline');
  const timers = useRef<number[]>([]);
  // Realtime can redeliver on reconnect; never toast the same row twice.
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!active) return;
    try {
      const rows = await api.notifications.list();
      rows.forEach((row) => seen.current.add(row.id));
      setItems(rows);
    } catch {
      // The history is nice to have; the live stream is the point.
    }
  }, [active]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (row: NotificationRow) => {
      setToasts((current) => [...current, row].slice(-MAX_TOASTS));
      const timer = window.setTimeout(() => dismiss(row.id), TOAST_MS);
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(() => {
    if (!active) {
      setItems([]);
      setToasts([]);
      setLive('offline');
      seen.current.clear();
      return;
    }
    void load();

    const stream = createNotificationStream({
      config: () => api.profile.realtime(),
      getToken: () => getAccessToken(),
      onState: setLive,
      onInsert: (row) => {
        if (seen.current.has(row.id)) return;
        seen.current.add(row.id);
        setItems((current) => [row, ...current]);
        if (!row.read_at) show(row);
        // The server just wrote into the chat (a scheduled AI task, the brief):
        // let an open conversation pull it in.
        if (row.deeplink === '/assistant') {
          window.dispatchEvent(new Event('mypro:assistant-updated'));
        }
        // A schedule ran: its status in the list has changed.
        if (row.schedule_id) window.dispatchEvent(new Event('mypro:schedules-updated'));
      },
      onUpdate: (row) => {
        setItems((current) => current.map((item) => (item.id === row.id ? row : item)));
        if (row.read_at) dismiss(row.id);
      },
    });

    return () => {
      stream.close();
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current = [];
    };
  }, [active, load, show, dismiss]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic: the socket echoes the same change back for other devices.
    const at = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read_at: at } : item)),
    );
    dismiss(id);
    try {
      await api.notifications.markRead(id);
    } catch {
      void load();
    }
  }, [dismiss, load]);

  const markAllRead = useCallback(async () => {
    const at = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? at })));
    setToasts([]);
    try {
      await api.notifications.markAllRead();
    } catch {
      void load();
    }
  }, [load]);

  return {
    items,
    unread: items.filter((item) => !item.read_at).length,
    live,
    toasts,
    dismiss,
    markRead,
    markAllRead,
    reload: () => void load(),
  };
}
