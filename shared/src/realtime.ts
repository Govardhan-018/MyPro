/**
 * In-app notifications over Supabase Realtime (Roadmap Phase 6.1).
 *
 * One mechanism for both clients: the socket carries the user's own JWT, so
 * the `notifications` RLS policy decides what arrives — a subscription can
 * only ever see its owner's rows. Render hands out the project URL and the
 * publishable key at runtime (`GET /me/realtime`), so neither bundle holds a
 * Supabase value.
 *
 * Platform-free: `@supabase/supabase-js` works unchanged on web and React
 * Native, and nothing here touches the DOM.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { NotificationRow } from './types';

export interface RealtimeConfig {
  url: string;
  publishable_key: string;
}

export type RealtimeState = 'connecting' | 'live' | 'offline';

export interface NotificationStreamOptions {
  /** Usually `api.realtime.config` — fetched once, then cached by the caller. */
  config(): Promise<RealtimeConfig>;
  /** A fresh access token; the stream re-authorises the socket with it. */
  getToken(): Promise<string | null>;
  /** A notification just arrived. */
  onInsert(row: NotificationRow): void;
  /** A notification changed elsewhere (read on another device). */
  onUpdate?(row: NotificationRow): void;
  onState?(state: RealtimeState): void;
}

export interface NotificationStream {
  close(): void;
}

const isRow = (value: unknown): value is NotificationRow =>
  !!value && typeof (value as NotificationRow).id === 'string';

/**
 * Open the stream. Returns immediately; the connection is established in the
 * background and reported through `onState`. Failure is never thrown — a
 * companion that cannot open a socket still works, it just stops being live.
 */
export function createNotificationStream(
  options: NotificationStreamOptions,
): NotificationStream {
  let closed = false;
  let client: SupabaseClient | null = null;
  let channel: RealtimeChannel | null = null;

  const setState = (state: RealtimeState) => {
    if (!closed) options.onState?.(state);
  };

  void (async () => {
    try {
      setState('connecting');
      const [{ url, publishable_key }, token] = await Promise.all([
        options.config(),
        options.getToken(),
      ]);
      if (closed || !url || !publishable_key || !token) {
        setState('offline');
        return;
      }

      client = createClient(url, publishable_key, {
        auth: { persistSession: false, autoRefreshToken: false },
        // The session is Render's to manage; this client exists only for the
        // websocket, and `realtime.setAuth` is what RLS actually reads.
        realtime: { params: { eventsPerSecond: 5 } },
      });
      await client.realtime.setAuth(token);

      channel = client
        .channel('mypro-notifications')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications' },
          (payload) => {
            if (!closed && isRow(payload.new)) options.onInsert(payload.new);
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'notifications' },
          (payload) => {
            if (!closed && isRow(payload.new)) options.onUpdate?.(payload.new);
          },
        )
        .subscribe((status) => {
          if (closed) return;
          if (status === 'SUBSCRIBED') setState('live');
          else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setState('offline');
          }
        });
    } catch {
      setState('offline');
    }
  })();

  return {
    close() {
      closed = true;
      if (channel) void client?.removeChannel(channel);
      void client?.realtime.disconnect();
      channel = null;
      client = null;
    },
  };
}
