import { useEffect, useState } from 'react';
import type { AuthSession } from '@mypro/shared';
import { getSession, onAuthChange } from './supabase';
import { isApiConfigured } from './env';

export interface SessionState {
  /** The current session, or null when signed out. */
  session: AuthSession | null;
  /** True while the stored session is being restored. */
  loading: boolean;
  /** Whether the backend (Render) is configured at all. */
  configured: boolean;
}

/**
 * Tracks the auth session: restores it on load, then stays in sync via
 * `onAuthChange` (sign-in, sign-out, token refresh). Reports
 * `configured: false` immediately when Render isn't configured so the app can
 * fall back to its local-only prototype mode.
 */
export function useSession(): SessionState {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState<boolean>(isApiConfigured);

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
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = onAuthChange((next) => {
      if (!active) return;
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { session, loading, configured: isApiConfigured };
}
