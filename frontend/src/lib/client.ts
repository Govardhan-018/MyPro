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

/**
 * In production the agent's URL is discovered through Render (the Cloudflare
 * tunnel changes on every start), so `VITE_AGENT_URL` is normally blank. But in
 * local dev there is no tunnel and `node_status.base_url` is empty, so
 * discovery fails and the assistant looks permanently offline. Default to the
 * laptop's local port during `vite dev` unless the env overrides it — the same
 * value `frontend/.env.example` documents. `import.meta.env.DEV` is false in a
 * production build, so this never leaks into the deployed app.
 */
const agentUrl =
  read('VITE_AGENT_URL') || (import.meta.env.DEV ? 'http://localhost:8787/api/v1' : '');

export const client = createClient({
  env: {
    apiUrl: read('VITE_API_URL'),
    agentUrl,
  },
  storage: webStorage,
});
