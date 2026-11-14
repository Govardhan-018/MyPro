/**
 * Web view of the resolved client configuration. The actual reading of Vite
 * env vars and normalization happens in `./client` via `@mypro/shared`; this
 * module just surfaces the resolved values and the config predicates under the
 * names the app already uses.
 */
import { client } from './client';
import {
  isAgentConfigured as isAgentConfiguredFn,
  isApiConfigured as isApiConfiguredFn,
  isBackendConfigured as isBackendConfiguredFn,
  isSupabaseConfigured as isSupabaseConfiguredFn,
  assertApiConfigured as assertApiConfiguredFn,
  assertAgentConfigured as assertAgentConfiguredFn,
} from '@mypro/shared';

export const appEnv = client.env;

export const isSupabaseConfigured = isSupabaseConfiguredFn(appEnv);
export const isApiConfigured = isApiConfiguredFn(appEnv);
export const isAgentConfigured = isAgentConfiguredFn(appEnv);
export const isBackendConfigured = isBackendConfiguredFn(appEnv);

export function assertApiConfigured(): void {
  assertApiConfiguredFn(appEnv);
}

export function assertAgentConfigured(): void {
  assertAgentConfiguredFn(appEnv);
}
