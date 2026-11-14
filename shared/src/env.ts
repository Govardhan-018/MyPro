import type { EnvConfig } from './platform';

const trim = (v: string | undefined) => (v ?? '').trim();
const stripSlash = (v: string | undefined) => trim(v).replace(/\/$/, '');

/** Normalize raw host env into a clean {@link EnvConfig} (trim, strip slashes). */
export function normalizeEnv(raw: Partial<EnvConfig>): EnvConfig {
  return {
    supabaseUrl: trim(raw.supabaseUrl),
    supabaseAnonKey: trim(raw.supabaseAnonKey),
    apiUrl: stripSlash(raw.apiUrl),
    agentUrl: stripSlash(raw.agentUrl),
  };
}

export const isSupabaseConfigured = (e: EnvConfig): boolean =>
  Boolean(e.supabaseUrl && e.supabaseAnonKey);

export const isApiConfigured = (e: EnvConfig): boolean =>
  isSupabaseConfigured(e) && Boolean(e.apiUrl);

/** The agent needs auth + a way to be found; the URL itself may be discovered. */
export const isAgentConfigured = (e: EnvConfig): boolean => isApiConfigured(e);

/** The always-on core is the baseline for the app to be usable at all. */
export const isBackendConfigured = (e: EnvConfig): boolean => isApiConfigured(e);

function missingOf(e: EnvConfig): string[] {
  return (
    [
      ['supabaseUrl', e.supabaseUrl],
      ['supabaseAnonKey', e.supabaseAnonKey],
      ['apiUrl', e.apiUrl],
    ] as [string, string][]
  )
    .filter(([, v]) => !v)
    .map(([k]) => k);
}

export function assertApiConfigured(e: EnvConfig): void {
  if (isApiConfigured(e)) return;
  throw new Error(`backend-render is not configured. Missing: ${missingOf(e).join(', ')}`);
}

export function assertAgentConfigured(e: EnvConfig): void {
  if (isAgentConfigured(e)) return;
  throw new Error(`Cannot reach the laptop agent. Missing: ${missingOf(e).join(', ')}`);
}
