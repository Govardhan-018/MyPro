import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@mypro/shared';

/**
 * The one configured client for the Android app — the mirror of the web app's
 * `frontend/src/lib/client.ts`, built from the same `@mypro/shared` core. The
 * only differences are the platform bits: AsyncStorage for the Supabase
 * session, a deep-link OAuth redirect, and no URL session detection.
 *
 * Config comes from `EXPO_PUBLIC_*` env vars, which Expo inlines at build time.
 * With none set the app still builds and runs on local state — the shared
 * config predicates report `false` — exactly like the web app.
 */
export const client = createClient({
  env: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
    agentUrl: process.env.EXPO_PUBLIC_AGENT_URL ?? '',
  },
  storage: AsyncStorage,
  redirectTo: 'mypro://auth-callback',
  detectSessionInUrl: false,
});
