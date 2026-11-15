import type { EnvConfig } from './platform';

const trim = (v: string | undefined) => (v ?? '').trim();
const stripSlash = (v: string | undefined) => trim(v).replace(/\/+$/, '');

/** Both backends mount every route under this prefix (`app.setGlobalPrefix`). */
const API_PATH = '/api/v1';

/**
 * Point a configured base URL at the API root, whichever way it was written.
 *
 * Both NestJS apps serve under `/api/v1`, so a base URL without it 404s with
 * "Cannot POST /auth/login" — which is exactly what a bare Render URL in
 * `EXPO_PUBLIC_API_URL` produced on Android, and the error is opaque enough to
 * look like a missing route rather than a missing prefix. Accepting the host on
 * its own costs one regex and removes a whole class of setup failure; a URL
 * that already carries the prefix is left untouched.
 */
function withApiPath(url: string): string {
  if (!url) return '';
  if (/\/api\/v\d+$/.test(url)) return url; // already complete
  if (/\/api$/.test(url)) return `${url}/v1`; // half-specified
  return `${url}${API_PATH}`;
}

/** Normalize raw host env into a clean {@link EnvConfig} (trim, strip slashes). */
export function normalizeEnv(raw: Partial<EnvConfig>): EnvConfig {
  return {
    apiUrl: withApiPath(stripSlash(raw.apiUrl)),
    agentUrl: withApiPath(stripSlash(raw.agentUrl)),
  };
}

/** The core API (Render) is the single thing a client must be pointed at. */
export const isApiConfigured = (e: EnvConfig): boolean => Boolean(e.apiUrl);

/** The agent needs the core API to reach it + be discovered; the URL may be empty. */
export const isAgentConfigured = (e: EnvConfig): boolean => isApiConfigured(e);

/** The always-on core is the baseline for the app to be usable at all. */
export const isBackendConfigured = (e: EnvConfig): boolean => isApiConfigured(e);

export function assertApiConfigured(e: EnvConfig): void {
  if (isApiConfigured(e)) return;
  throw new Error('backend-render is not configured. Missing: apiUrl');
}

export function assertAgentConfigured(e: EnvConfig): void {
  if (isAgentConfigured(e)) return;
  throw new Error('Cannot reach the laptop agent. Missing: apiUrl');
}
