import type { EnvConfig } from './platform';

const trim = (v: string | undefined) => (v ?? '').trim();
const stripSlash = (v: string | undefined) => trim(v).replace(/\/$/, '');

/** Normalize raw host env into a clean {@link EnvConfig} (trim, strip slashes). */
export function normalizeEnv(raw: Partial<EnvConfig>): EnvConfig {
  return {
    apiUrl: stripSlash(raw.apiUrl),
    agentUrl: stripSlash(raw.agentUrl),
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
