/**
 * The platform seam. Everything platform-specific the shared core needs is
 * passed in here, so the same code runs unchanged on the web (fetch +
 * localStorage + Vite env) and on Android/React Native (fetch + AsyncStorage +
 * its own env). Nothing in `shared/` reads `import.meta`, `window`, or any
 * Vite/RN global directly — it only ever sees a `Platform`.
 */

/** Resolved client configuration. URLs already have trailing slashes stripped. */
export interface EnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
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
 * The subset of supabase-js's `SupportedStorage` the auth layer needs.
 * Satisfied by the browser's `localStorage` and by React Native's
 * `@react-native-async-storage/async-storage`.
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
  /** Supabase session storage. Web omits it (localStorage); RN passes AsyncStorage. */
  storage?: AuthStorage;
  /** OAuth redirect target (web: `window.location.origin`; RN: a deep link). */
  redirectTo?: string;
  /** Parse the session out of the URL after an OAuth redirect. Web: true; RN: false. */
  detectSessionInUrl?: boolean;
}
