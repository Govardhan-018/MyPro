import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import { appEnv, isSupabaseConfigured } from './env';

/**
 * Browser Supabase client (anon key only — it is safe to ship, and RLS is
 * what actually protects the data). Null until the project is configured.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(appEnv.supabaseUrl, appEnv.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Fresh access token for API calls; supabase-js refreshes it as needed. */
export async function getAccessToken(): Promise<string | null> {
  return (await getSession())?.access_token ?? null;
}

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.session;
}

export async function signUpWithPassword(email: string, password: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data.session;
}

export async function signInWithOAuth(provider: 'google' | 'apple') {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  await supabase?.auth.signOut();
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
