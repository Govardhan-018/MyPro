/**
 * Web Push (Phase 6.2) — reaching the browser when no tab is open.
 *
 * Realtime (6.1) already covers an open app. This is the other half: a service
 * worker subscription, filed in `device_tokens`, which the laptop's fan-out
 * sends to when a notification is written.
 *
 * Nothing here is baked into the bundle. The VAPID public key arrives from
 * `GET /me/push`, so rotating the key pair needs no client release — and when
 * the server has no keys the hook reports `unsupported` with a reason rather
 * than offering a button that silently does nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { isApiConfigured } from './env';

export type PushStatus =
  /** Still working out where we stand. */
  | 'checking'
  /** This browser cannot do it, or the server has no VAPID keys. */
  | 'unsupported'
  /** Possible, not yet subscribed. */
  | 'idle'
  /** The user said no at the OS prompt. Only they can undo this. */
  | 'denied'
  | 'subscribing'
  | 'subscribed'
  | 'error';

export interface PushState {
  status: PushStatus;
  /** Why it is unsupported or what went wrong — shown verbatim in Settings. */
  reason: string | null;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

/**
 * The server sends the VAPID key base64url-encoded; `subscribe()` wants raw
 * bytes. Padding and the URL-safe alphabet both have to be undone, and
 * getting this wrong fails late with an opaque InvalidAccessError.
 */
function decodeVapidKey(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const canPush = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export function usePush(enabled: boolean): PushState {
  const active = isApiConfigured && enabled;
  const [status, setStatus] = useState<PushStatus>('checking');
  const [reason, setReason] = useState<string | null>(null);
  /** Fetched once and reused; the key does not change while a tab is open. */
  const vapidKey = useRef<string | null>(null);

  const registration = useCallback(async (): Promise<ServiceWorkerRegistration> => {
    // `register` resolves before the worker is usable; `ready` is the one
    // that guarantees an active worker to subscribe through.
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return navigator.serviceWorker.ready;
  }, []);

  /** Where we stand right now, without prompting the user for anything. */
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (!active) {
        setStatus('unsupported');
        setReason('Sign in to manage push notifications.');
        return;
      }
      if (!canPush()) {
        setStatus('unsupported');
        setReason('This browser does not support push notifications.');
        return;
      }

      try {
        const { key } = await api.profile.pushKey();
        if (cancelled) return;
        if (!key) {
          setStatus('unsupported');
          setReason('Push is not configured on the server yet (no VAPID keys).');
          return;
        }
        vapidKey.current = key;

        if (Notification.permission === 'denied') {
          setStatus('denied');
          setReason('Notifications are blocked for this site in your browser settings.');
          return;
        }

        // An existing subscription means we are already set up — but only if
        // the service worker is still registered, which `ready` confirms.
        const reg = await navigator.serviceWorker.getRegistration('/');
        const existing = reg ? await reg.pushManager.getSubscription() : null;
        if (cancelled) return;

        setReason(null);
        setStatus(existing ? 'subscribed' : 'idle');
      } catch (err) {
        if (cancelled) return;
        setStatus('error');
        setReason(err instanceof Error ? err.message : 'Could not check push status.');
      }
    };

    void check();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const subscribe = useCallback(async () => {
    if (!canPush() || !vapidKey.current) return;
    setStatus('subscribing');
    setReason(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'idle');
        setReason(
          permission === 'denied'
            ? 'Notifications are blocked for this site in your browser settings.'
            : null,
        );
        return;
      }

      const reg = await registration();
      // Reuse an existing subscription rather than creating a second one for
      // the same browser; the push service would accept both and you would
      // get every notification twice.
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(vapidKey.current) as BufferSource,
        }));

      await api.devices.register({
        channel_type: 'web_push',
        token: JSON.stringify(sub.toJSON()),
        platform: navigator.userAgent.slice(0, 60),
      });

      setStatus('subscribed');
    } catch (err) {
      setStatus('error');
      setReason(err instanceof Error ? err.message : 'Could not subscribe to push.');
    }
  }, [registration]);

  const unsubscribe = useCallback(async () => {
    if (!canPush()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        // Tell the server first: if unsubscribing locally succeeded and the
        // delete failed, the row would be retried on every notification
        // until a push service eventually answered 410.
        await api.devices.unregister(JSON.stringify(sub.toJSON())).catch(() => undefined);
        await sub.unsubscribe();
      }
      setStatus('idle');
      setReason(null);
    } catch (err) {
      setStatus('error');
      setReason(err instanceof Error ? err.message : 'Could not unsubscribe.');
    }
  }, []);

  return { status, reason, subscribe, unsubscribe };
}

/**
 * Sign-out cleanup: withdraw this browser's push subscription *while the
 * session is still valid*, so a signed-out browser stops receiving the
 * account's notifications (on a shared computer, to whoever is there next).
 * Bounded so a slow network never holds up the sign-out itself.
 */
export async function releasePushOnSignOut(timeoutMs = 2500): Promise<void> {
  if (!canPush()) return;
  const work = (async () => {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await api.devices.unregister(JSON.stringify(sub.toJSON())).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  })().catch(() => undefined);
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
}
