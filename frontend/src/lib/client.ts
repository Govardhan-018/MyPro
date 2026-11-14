import { createClient, type AuthStorage } from '@mypro/shared';

/**
 * The one configured client for the web app. Thin-client model: the only
 * backend configured is Render (`VITE_API_URL`). Auth is brokered by Render,
 * and the laptop agent's URL is discovered through it — no Supabase values live
 * in the client. `VITE_AGENT_URL` is an optional override for a fixed tunnel.
 *
 * The app stays usable before configuration: the shared predicates report
 * `false` and the UI keeps running on local state.
 */
const read = (key: string): string =>
  ((import.meta.env as Record<string, string | undefined>)[key] ?? '').trim();

const webStorage: AuthStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode / storage disabled */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const client = createClient({
  env: {
    apiUrl: read('VITE_API_URL'),
    agentUrl: read('VITE_AGENT_URL'),
  },
  storage: webStorage,
});
