/**
 * The native-shell seam (Android upgrade, §2).
 *
 * The phone is a thin `react-native-webview` shell around this very web app —
 * one codebase, one design, one place a bug is fixed. The shell announces
 * itself before the page loads (`window.__MYPRO_SHELL__`), and this module is
 * the *single* place the web app reads that. Everything else imports `inShell`
 * and `postToShell` from here, so every divergence between the browser and the
 * app is countable in one file.
 *
 *   > Branch on presentation and platform integration only. Never on features
 *   > or data.
 *
 * If a branch changes *what the user can do* rather than *how it feels*, the
 * second app is growing back — which is the whole thing this upgrade exists to
 * escape.
 */
import { getSession, onAuthChange } from './supabase';
import type { AuthSession } from '@mypro/shared';

declare global {
  interface Window {
    /** Injected by the shell before content loads, e.g. "1.0". */
    __MYPRO_SHELL__?: string;
    /** Present automatically inside react-native-webview. */
    ReactNativeWebView?: { postMessage: (data: string) => void };
  }
}

/** A message the web posts out to the native shell. Keep the shapes narrow. */
export type ShellMessage =
  /** The current auth session (or null when signed out), for the native clock. */
  | { type: 'session'; session: AuthSession | null }
  /** A short tactile tap on a meaningful action. */
  | { type: 'haptic'; kind: 'light' | 'medium' | 'success' };

/**
 * Are we running inside the native shell? Read once at module load: the marker
 * is injected `injectedJavaScriptBeforeContentLoaded`, so it is already present
 * by the time any module evaluates. `ReactNativeWebView` is the belt-and-braces
 * fallback in case the marker ever fails to inject.
 */
export const inShell: boolean =
  typeof window !== 'undefined' &&
  (typeof window.__MYPRO_SHELL__ === 'string' || Boolean(window.ReactNativeWebView));

/** The shell's version string, or null in an ordinary browser. */
export const shellVersion: string | null =
  typeof window !== 'undefined' ? (window.__MYPRO_SHELL__ ?? null) : null;

/** Post a message to the native shell. A no-op in an ordinary browser. */
export function postToShell(message: ShellMessage): void {
  if (typeof window === 'undefined') return;
  try {
    window.ReactNativeWebView?.postMessage(JSON.stringify(message));
  } catch {
    /* the bridge can be momentarily unavailable; a dropped message is harmless */
  }
}

/** A light haptic tap, routed to the shell. No-op in a browser. */
export function shellHaptic(kind: 'light' | 'medium' | 'success' = 'light'): void {
  if (inShell) postToShell({ type: 'haptic', kind });
}

let initialised = false;

/**
 * Wire the shell integration. Called once, as early as possible, from
 * `main.tsx` — before React paints, so the `.in-shell` class and the viewport
 * are right on the first frame.
 *
 * All of it is presentation and platform plumbing:
 *  - a `.in-shell` class on <body> so the bulk of the native feel is one CSS
 *    block rather than a hundred inline checks;
 *  - `viewport-fit=cover`, which `index.html` deliberately omits because it
 *    breaks an ordinary Android tab (safe-area insets read 0 there) — inside
 *    the WebView the insets resolve, and without cover the layout ignores the
 *    notch and the home indicator, which reads as "web page" instantly;
 *  - the session bridge: the web owns sign-in, and posts the resulting session
 *    out so the native clock (`armUpcoming`) keeps a live token.
 */
export function initShell(): void {
  if (initialised || typeof window === 'undefined') return;
  initialised = true;
  if (!inShell) return;

  document.body.classList.add('in-shell');

  // Let the page paint under the system bars so `env(safe-area-inset-*)` has
  // something to resolve to. Only in the shell — see index.html's note.
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    const content = viewport.getAttribute('content') ?? '';
    if (!/viewport-fit=/.test(content)) {
      viewport.setAttribute('content', `${content}, viewport-fit=cover`);
    }
  }

  // Push the session out now and on every auth change. The shell persists it
  // and re-arms the clock; a dropped message is recovered on the next change
  // or the next cold start (the shell reads storage too).
  void getSession().then((session) => postToShell({ type: 'session', session }));
  onAuthChange((session) => postToShell({ type: 'session', session }));
}
