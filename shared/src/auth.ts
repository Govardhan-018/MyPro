import {
  createClient as createSupabaseClient,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';
import type { AuthStorage, EnvConfig } from './platform';
import { isSupabaseConfigured } from './env';

export interface AuthOptions {
  /** Session storage. Web omits it (localStorage); RN passes AsyncStorage. */
  storage?: AuthStorage;
  /** OAuth redirect target. */
  redirectTo?: string;
  /** Parse the session out of the URL after an OAuth redirect (web only). */
  detectSessionInUrl?: boolean;
}

/** Supabase session handling, platform-agnostic. `supabase` is null until configured. */
export interface Auth {
  readonly supabase: SupabaseClient | null;
  getSession(): Promise<Session | null>;
  /** Fresh access token for API calls; supabase-js refreshes it as needed. */
  getAccessToken(): Promise<string | null>;
  signInWithPassword(email: string, password: string): Promise<Session | null>;
  signUpWithPassword(email: string, password: string): Promise<Session | null>;
  signInWithOAuth(provider: 'google' | 'apple'): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: (session: Session | null) => void): () => void;
}

export function createAuth(env: EnvConfig, opts: AuthOptions = {}): Auth {
  const supabase: SupabaseClient | null = isSupabaseConfigured(env)
    ? createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: opts.detectSessionInUrl ?? true,
          ...(opts.storage ? { storage: opts.storage } : {}),
        },
      })
    : null;

  async function getSession(): Promise<Session | null> {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session;
  }

  return {
    supabase,
    getSession,
    async getAccessToken() {
      return (await getSession())?.access_token ?? null;
    },
    async signInWithPassword(email, password) {
      if (!supabase) throw new Error('Supabase is not configured');
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      return data.session;
    },
    async signUpWithPassword(email, password) {
      if (!supabase) throw new Error('Supabase is not configured');
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw new Error(error.message);
      return data.session;
    },
    async signInWithOAuth(provider) {
      if (!supabase) throw new Error('Supabase is not configured');
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: opts.redirectTo ? { redirectTo: opts.redirectTo } : undefined,
      });
      if (error) throw new Error(error.message);
    },
    async signOut() {
      await supabase?.auth.signOut();
    },
    onAuthChange(cb) {
      if (!supabase) return () => {};
      const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
      return () => data.subscription.unsubscribe();
    },
  };
}
