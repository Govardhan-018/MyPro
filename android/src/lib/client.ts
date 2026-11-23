import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@mypro/shared';
import { shellEnabled } from './shell';

/**
 * The one configured client for the Android app — the mirror of the web app's
 * client. Thin-client model: the only backend configured is Render
 * (`EXPO_PUBLIC_API_URL`). Auth is brokered by Render and the laptop agent's
 * URL is discovered through it, so the app holds no Supabase values. Expo
 * inlines `EXPO_PUBLIC_*` at build time; with none set the app still runs on
 * local state.
 *
 * **Refresh mode.** In the WebView shell (the default), sign-in happens *inside*
 * the hosted web app, which owns the one refresh loop and posts each fresh
 * session out to this native client. So here it is a `'follower'`: it must not
 * refresh on its own, or it would rotate the shared Supabase refresh token out
 * from under the web and sign the user out within the hour. In the legacy
 * native build (`EXPO_PUBLIC_SHELL=native`) this client signs in directly and
 * is the primary, so it refreshes itself.
 */
export const client = createClient({
  env: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
    agentUrl: process.env.EXPO_PUBLIC_AGENT_URL ?? '',
  },
  storage: AsyncStorage,
  refreshMode: shellEnabled() ? 'follower' : 'self',
});
