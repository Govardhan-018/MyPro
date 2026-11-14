import { createClient } from '@mypro/shared';

/**
 * The one configured client for the web app. All platform specifics are
 * supplied here; everything under `@/lib/*` re-exports from this instance, so
 * the rest of the app imports from `@/lib/api` / `@/lib/supabase` exactly as
 * before. The shared core itself never touches Vite globals.
 *
 * Two backends, by design:
 *   VITE_API_URL   → backend-render  (always on: data, schedules, notifications)
 *   VITE_AGENT_URL → backend-local   (your laptop: the assistant / LLM)
 *
 * The app stays usable before any of this is configured — the shared config
 * predicates report `false` and the UI keeps running on local state.
 */
const read = (key: string): string =>
  ((import.meta.env as Record<string, string | undefined>)[key] ?? '').trim();

export const client = createClient({
  env: {
    supabaseUrl: read('VITE_SUPABASE_URL'),
    supabaseAnonKey: read('VITE_SUPABASE_ANON_KEY'),
    apiUrl: read('VITE_API_URL'),
    agentUrl: read('VITE_AGENT_URL'),
  },
  // Web: global fetch + localStorage are the defaults, so only the OAuth
  // redirect target needs supplying.
  redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
  detectSessionInUrl: true,
});
