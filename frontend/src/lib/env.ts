/**
 * Client configuration. Everything comes from Vite env vars — nothing about
 * Supabase, the render API, the laptop agent, or models is hardcoded.
 *
 * Two backends, by design:
 *   VITE_API_URL   → backend-render  (always on: data, schedules, notifications)
 *   VITE_AGENT_URL → backend-local   (your laptop: the assistant / LLM)
 *
 * The app stays usable before any of this is configured: the flags below are
 * false and the UI keeps running on local state.
 */
const read = (key: string): string =>
  ((import.meta.env as Record<string, string | undefined>)[key] ?? '').trim();

const stripSlash = (v: string) => v.replace(/\/$/, '');

export const appEnv = {
  supabaseUrl: read('VITE_SUPABASE_URL'),
  supabaseAnonKey: read('VITE_SUPABASE_ANON_KEY'),
  /** backend-render base, e.g. https://mypro.onrender.com/api/v1 */
  apiUrl: stripSlash(read('VITE_API_URL')),
  /**
   * backend-local (agent) base, e.g. https://agent.example.com/api/v1.
   * Optional: leave it empty and the URL is discovered at runtime from
   * node_status (which the laptop heartbeats), so an ephemeral Cloudflare
   * quick-tunnel hostname needs no rebuild.
   */
  agentUrl: stripSlash(read('VITE_AGENT_URL')),
} as const;

export const isSupabaseConfigured = Boolean(appEnv.supabaseUrl && appEnv.supabaseAnonKey);
export const isApiConfigured = isSupabaseConfigured && Boolean(appEnv.apiUrl);
/** The agent needs auth + a way to be found; the URL itself may be discovered. */
export const isAgentConfigured = isApiConfigured;
export const isBackendConfigured = isApiConfigured; // the core is the baseline

function missingOf(pairs: [string, string][]): string[] {
  return pairs.filter(([, v]) => !v).map(([k]) => k);
}

export function assertApiConfigured(): void {
  if (isApiConfigured) return;
  const missing = missingOf([
    ['VITE_SUPABASE_URL', appEnv.supabaseUrl],
    ['VITE_SUPABASE_ANON_KEY', appEnv.supabaseAnonKey],
    ['VITE_API_URL', appEnv.apiUrl],
  ]);
  throw new Error(`backend-render is not configured. Missing: ${missing.join(', ')} (see .env.example)`);
}

export function assertAgentConfigured(): void {
  if (isAgentConfigured) return;
  const missing = missingOf([
    ['VITE_SUPABASE_URL', appEnv.supabaseUrl],
    ['VITE_SUPABASE_ANON_KEY', appEnv.supabaseAnonKey],
    ['VITE_API_URL', appEnv.apiUrl],
  ]);
  throw new Error(
    `Cannot reach the laptop agent. Missing: ${missing.join(', ')} (see .env.example)`,
  );
}
