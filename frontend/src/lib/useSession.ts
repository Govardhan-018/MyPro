import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSession, onAuthChange } from './supabase';
import { isSupabaseConfigured } from './env';

export interface SessionState {
  /** The current Supabase session, or null when signed out. */
  session: Session | null;
  /** True while the initial session is being restored from storage. */
  loading: boolean;
  /** Whether Supabase is configured at all (env present). */
  configured: boolean;
}

/**
 * Tracks the Supabase auth session: restores it on load, then stays in sync via
 * `onAuthChange` (sign-in, sign-out, token refresh, OAuth redirect return).
 * When Supabase isn't configured it reports `configured: false` immediately so
 * the app can fall back to its local-only prototype mode.
 */
export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) {
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

  return { session, loading, configured: isSupabaseConfigured };
}
