import { useEffect } from 'react';
import { api } from './api';
import { isApiConfigured } from './env';

const THROTTLE_MS = 30_000;

/**
 * Pings `POST /me/activity` so backend-render knows the user is around — this
 * is what drives the inactivity nudge. Fires on mount and whenever the tab
 * regains focus or becomes visible again, throttled so a flurry of focus
 * events is one request. No-ops when disabled or when the core API isn't
 * configured; failures are swallowed (presence is best-effort).
 */
export function useActivityHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !isApiConfigured) return;

    let last = 0;
    const beat = () => {
      const now = Date.now();
      if (now - last < THROTTLE_MS) return;
      last = now;
      api.profile.heartbeat('web').catch(() => {});
    };

    beat();
    const onFocus = () => beat();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
