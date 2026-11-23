/**
 * Shell configuration — the native half of the Android upgrade.
 *
 * The phone is a thin `react-native-webview` shell around the deployed web app
 * (`docs/ANDROID_UPGRADE.md`). This module holds the few constants that decide
 * what the shell loads and how it announces itself; the behaviour lives in
 * `ShellApp.tsx`, and the clock it keeps alive lives in `notifications.ts`.
 *
 * Nothing here is hardcoded: the web URL comes from the environment, like the
 * API URL, so a fork or a preview build points somewhere else without a code
 * change.
 */

const stripSlash = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');

/**
 * The deployed web app the shell loads (Vercel in production). Public, inlined
 * at build time like every `EXPO_PUBLIC_*`. Empty → the shell shows a setup
 * screen rather than a blank WebView.
 */
export const WEB_URL = stripSlash(process.env.EXPO_PUBLIC_WEB_URL);

/** Whether a web URL is configured at all. */
export const isWebConfigured = Boolean(WEB_URL);

/** The marker this build announces itself with. Bump on a breaking shell change. */
export const SHELL_VERSION = '1.0';

/**
 * Injected before the page's own scripts run, so `window.__MYPRO_SHELL__` is
 * already set by the time the web app's modules evaluate and read it (see
 * `frontend/src/lib/shell.ts`). `react-native-webview` also exposes
 * `window.ReactNativeWebView` automatically, which is the fallback check.
 *
 * The trailing `true;` is required: react-native-webview warns when injected
 * JavaScript does not end in a literal value.
 */
export const INJECTED_BEFORE = `window.__MYPRO_SHELL__ = '${SHELL_VERSION}'; true;`;

/**
 * Whether to run as the WebView shell (the default) or the legacy native
 * screens. The native UI stays one release behind this flag — set
 * `EXPO_PUBLIC_SHELL` to `native` / `0` / `false` / `off` to get it back —
 * until the shell is proven on a real device, then it is deleted
 * (`docs/ANDROID_UPGRADE.md` §3, steps 5–6).
 */
export function shellEnabled(): boolean {
  const flag = (process.env.EXPO_PUBLIC_SHELL ?? '').trim().toLowerCase();
  return !['native', '0', 'false', 'off', 'no'].includes(flag);
}
