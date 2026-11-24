import { useEffect, useState } from 'react';
import type { AuthSession } from '@mypro/shared';
import {
  adoptSession,
  getAccessToken,
  getSession,
  onAuthChange,
  onSessionExpired,
} from './supabase';
import { isApiConfigured } from './env';

const SESSION_KEY = 'mypro.session';

export interface SessionState {
  /** The current session, or null when signed out. */
  session: AuthSession | null;
  /** True while the stored session is being restored. */
  loading: boolean;
  /** Whether the backend (Render) is configured at all. */
  configured: boolean;
  /**
   * True when the last session ended involuntarily (refresh token rejected),
   * so the sign-in page can say why the user is there. Cleared on sign-in.
   */
  expired: boolean;
}

/**
 * Tracks the auth session: restores it on load, then stays in sync via
 * `onAuthChange` (sign-in, sign-out, token refresh). Reports
 * `configured: false` immediately when Render isn't configured so the app can
 * fall back to its local-only prototype mode.
 *
 * Also the app's lifecycle hook for auth:
 *  - **Resume.** Returning from the background (or regaining the network) asks
 *    for a fresh token right away. An expired access token is renewed before
 *    the first screen refetches, and a dead refresh token routes to sign-in at
 *    once instead of after a wall of failed requests.
 *  - **Other tabs.** A sign-in, refresh or sign-out in another tab arrives as a
 *    `storage` event and is adopted here, so tabs never fight over the
 *    single-use refresh token or keep showing a signed-out account.
 */
export function useSession(): SessionState {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState<boolean>(isApiConfigured);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!isApiConfigured) {
      setLoading(false);
      return;
    }
    let active = true;

    getSession()
      .then((restored) => {
        if (!active) return;
        setSession(restored);
        setLoading(false);
        // Validate a restored session immediately: an access token that
        // expired while the app was closed is refreshed now, and a refresh
        // token that died meanwhile ends here rather than on the first screen.
        if (restored) void getAccessToken().catch(() => undefined);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = onAuthChange((next) => {
      if (!active) return;
      setSession(next);
      if (next) setExpired(false);
      setLoading(false);
    });
    const unsubscribeExpired = onSessionExpired(() => {
      if (active) setExpired(true);
    });

    const resume = () => {
      if (document.visibilityState === 'visible') void getAccessToken().catch(() => undefined);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_KEY) return;
      let next: AuthSession | null = null;
      try {
        next = event.newValue ? (JSON.parse(event.newValue) as AuthSession) : null;
      } catch {
        next = null;
      }
      void adoptSession(next);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('storage', onStorage);

    return () => {
      active = false;
      unsubscribe();
      unsubscribeExpired();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return { session, loading, configured: isApiConfigured, expired };
}
