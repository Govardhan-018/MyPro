/**
 * Auth surface for the web app. Despite the filename (kept to avoid churn),
 * this no longer talks to Supabase directly — it re-exports the Render-brokered
 * auth from the shared client. The client holds no Supabase credentials.
 */
import type { AuthSession } from '@mypro/shared';
import { client } from './client';

const { auth } = client;

export type Session = AuthSession;

export const getSession = (): Promise<AuthSession | null> => auth.getSession();
export const getAccessToken = (): Promise<string | null> => auth.getAccessToken();
export const signInWithPassword = (email: string, password: string) =>
  auth.signInWithPassword(email, password);
export const signUpWithPassword = (email: string, password: string) =>
  auth.signUpWithPassword(email, password);
export const signInWithOAuth = (provider: 'google' | 'apple') => auth.signInWithOAuth(provider);
export const signOut = (): Promise<void> => auth.signOut();
export const onAuthChange = (cb: (session: AuthSession | null) => void): (() => void) =>
  auth.onAuthChange(cb);
