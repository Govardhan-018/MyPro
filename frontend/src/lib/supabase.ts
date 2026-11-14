/**
 * Web view of Supabase auth. The client itself (with the browser's
 * localStorage as session storage) is created in `./client` via
 * `@mypro/shared`; this module re-exports the session helpers under the names
 * the app already uses. The methods close over the client, so re-exporting
 * them as bare functions is safe.
 */
import type { Session } from '@supabase/supabase-js';
import { client } from './client';

const { auth } = client;

export const supabase = auth.supabase;

export const getSession = (): Promise<Session | null> => auth.getSession();
export const getAccessToken = (): Promise<string | null> => auth.getAccessToken();
export const signInWithPassword = (email: string, password: string) =>
  auth.signInWithPassword(email, password);
export const signUpWithPassword = (email: string, password: string) =>
  auth.signUpWithPassword(email, password);
export const signInWithOAuth = (provider: 'google' | 'apple') => auth.signInWithOAuth(provider);
export const signOut = (): Promise<void> => auth.signOut();
export const onAuthChange = (cb: (session: Session | null) => void): (() => void) =>
  auth.onAuthChange(cb);
