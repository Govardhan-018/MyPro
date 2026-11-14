import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@mypro/shared';

/**
 * The one configured client for the Android app — the mirror of the web app's
 * client. Thin-client model: the only backend configured is Render
 * (`EXPO_PUBLIC_API_URL`). Auth is brokered by Render and the laptop agent's
 * URL is discovered through it, so the app holds no Supabase values. Expo
 * inlines `EXPO_PUBLIC_*` at build time; with none set the app still runs on
 * local state.
 */
export const client = createClient({
  env: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '',
    agentUrl: process.env.EXPO_PUBLIC_AGENT_URL ?? '',
  },
  storage: AsyncStorage,
});
