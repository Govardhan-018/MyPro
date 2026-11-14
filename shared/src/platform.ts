/**
 * The platform seam. Everything platform-specific the shared core needs is
 * passed in here, so the same code runs unchanged on web (fetch + localStorage)
 * and on Android/React Native (fetch + AsyncStorage).
 *
 * Thin-client model: the only backend a client configures is Render
 * (`apiUrl`). Auth is brokered by Render — no Supabase URL or key lives in the
 * client. The laptop agent's URL is discovered at runtime via Render too.
 */

export interface EnvConfig {
  /** backend-render base, e.g. https://mypro.onrender.com/api/v1 */
  apiUrl: string;
  /**
   * backend-local (agent) base, e.g. https://agent.example.com/api/v1.
   * Empty string = discover at runtime from node_status (the laptop's
   * Cloudflare quick-tunnel URL changes on every start).
   */
  agentUrl: string;
}

/**
 * The subset of storage the auth layer needs to persist the session. Satisfied
 * by the browser's `localStorage` and by React Native's AsyncStorage.
 */
export interface AuthStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

/** Everything the shared core needs from its host. */
export interface Platform {
  /** Raw env; normalized by the core (trimmed, slashes stripped). */
  env: Partial<EnvConfig>;
  /** Fetch implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Where the auth session is persisted (web: localStorage; RN: AsyncStorage). */
  storage?: AuthStorage;
}
