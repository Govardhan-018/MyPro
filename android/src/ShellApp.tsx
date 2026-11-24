import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StatusBar as RNStatusBar,
  ScrollView,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';
import { Text } from './components/Typography';
import { client } from './lib/client';
import {
  clearDeviceForSignOut,
  fireTestNotification,
  notificationStatus,
  requestPermissionOrOpenSettings,
  syncClock,
  syncFromWeb,
} from './lib/notifications';
import { hashFromDeeplink } from '@mypro/shared';
import { INJECTED_BEFORE, WEB_URL, isWebConfigured } from './lib/shell';

/**
 * The Android app, as a thin native shell around the deployed web app
 * (`docs/ANDROID_UPGRADE.md`). One codebase, one design, one place a bug is
 * fixed: the UI *is* the web app, loaded in a WebView.
 *
 * What stays native, and only this, is what a web page cannot do:
 *
 *  - **The clock.** `armUpcoming()` schedules the next 48 hours of
 *    notifications with the OS and re-arms on every foreground, so the morning
 *    brief fires at 08:30 with the laptop shut and Render asleep. This is the
 *    whole reason the product is useful offline, and it is untouched by the
 *    move to a WebView.
 *  - **Push registration**, for what nobody could schedule in advance.
 *  - **The session bridge.** The web owns sign-in and posts its session out
 *    (`frontend/src/lib/shell.ts`); the shell adopts it so the clock above
 *    carries a live token without a second login.
 *  - **Platform integration:** the Android back button, notification deep
 *    links, and sending external links (OAuth consent) to the system browser.
 */

/** The status-bar inset, as the legacy native screens compute it. */
const STATUS_BAR = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 44;

/** The message shapes the web posts out. Mirrors `ShellMessage` on the web. */
type IncomingMessage =
  | { type: 'session'; session: Parameters<typeof client.auth.setSession>[0] }
  | { type: 'haptic'; kind: string }
  | { type: 'test-notification' }
  /** Schedules or calendar changed in the web: re-arm the clock right now. */
  | { type: 'rearm' }
  /** The web's own fetch of the next week's reminders — arm exactly these. */
  | { type: 'arm'; occurrences: unknown[] }
  /** Settings wants to know where notifications stand on this phone. */
  | { type: 'notification-status' }
  /** Ask for permission again, or open Android's settings if it was refused. */
  | { type: 'fix-notifications' };

export function ShellApp() {
  if (!isWebConfigured) return <SetupScreen />;
  return <Shell />;
}

function Shell() {
  const webRef = useRef<WebView>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const canGoBack = useRef(false);
  /** A deep-link requested before the page was ready; applied once it loads. */
  const pendingDeepLink = useRef<string | null>(null);
  /** A full navigation (Gmail return) requested before the page was ready. */
  const pendingNavigation = useRef<string | null>(null);
  const loadedRef = useRef(false);

  /**
   * Drive the web to a route by setting the hash its router reads. `hash` is
   * the exact string the notification carried (e.g. '' for Today, 'calendar?
   * event=…' for an event), built by the shared `notificationHash`. It is
   * JSON-stringified into the injected JS so an event id or ISO instant can
   * never break out of the assignment.
   */
  const openHash = useCallback((hash: string) => {
    if (!loaded) {
      pendingDeepLink.current = hash;
      return;
    }
    webRef.current?.injectJavaScript(`window.location.hash = ${JSON.stringify(hash)}; true;`);
  }, [loaded]);

  /** Deliver a reply to the web, as a `mypro-shell` DOM event. */
  const replyToWeb = useCallback((detail: unknown) => {
    const payload = JSON.stringify(detail);
    webRef.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent('mypro-shell', { detail: ${payload} })); true;`,
    );
  }, []);

  const sendStatus = useCallback(() => {
    void notificationStatus()
      .then((status) => replyToWeb({ type: 'notification-status', status }))
      .catch(() => undefined);
  }, [replyToWeb]);

  /**
   * Adopt a session posted by the web, so the native clock has a token. We
   * persist it (via the shared auth store) and re-arm immediately. On
   * sign-out or expiry, everything armed for the account is cancelled and the
   * push token withdrawn *first* (while the old token still authenticates),
   * then the WebView's back stack is cleared so the hardware back button
   * cannot walk into screens of a session that no longer exists.
   */
  const hadSession = useRef(false);
  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: IncomingMessage;
      try {
        message = JSON.parse(event.nativeEvent.data) as IncomingMessage;
      } catch {
        return;
      }
      if (message.type === 'session') {
        const { session } = message;
        if (session) {
          hadSession.current = true;
          void client.auth.setSession(session).then(() => syncClock());
        } else {
          const wasSignedIn = hadSession.current;
          hadSession.current = false;
          void clearDeviceForSignOut().finally(() => void client.auth.setSession(null));
          if (wasSignedIn && Platform.OS === 'android') webRef.current?.clearHistory?.();
          canGoBack.current = false;
        }
      } else if (message.type === 'test-notification') {
        void fireTestNotification().then((result) => {
          replyToWeb({ type: 'test-notification', result });
          sendStatus();
        });
      } else if (message.type === 'rearm') {
        void syncClock().then(sendStatus);
      } else if (message.type === 'arm' && Array.isArray(message.occurrences)) {
        void syncFromWeb(message.occurrences).then(sendStatus);
      } else if (message.type === 'notification-status') {
        sendStatus();
      } else if (message.type === 'fix-notifications') {
        void requestPermissionOrOpenSettings()
          .then(() => syncClock())
          .then(sendStatus);
      }
      // Other message types (e.g. haptics) are ignored until the shell handles
      // them — unknown messages must never throw.
    },
    [replyToWeb, sendStatus],
  );

  // Arm the clock from any already-stored session the moment the shell opens,
  // then keep it armed on every foreground *and* on the way to the background
  // (the last chance before a swipe-away to pick up a reminder created moments
  // ago). The web's session bridge refreshes the token; this is the
  // belt-and-braces path for when the web is slow or offline on launch.
  useEffect(() => {
    void syncClock();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' || state === 'background') {
        void syncClock();
        // The web's outbox (offline reading progress, notes) syncs on resume
        // and gets one last chance before Android may kill the app. A paused
        // WebView does not reliably fire visibilitychange, so say it directly.
        webRef.current?.injectJavaScript(
          "window.dispatchEvent(new Event('mypro:resume')); true;",
        );
      }
      // Returning from Android's settings page: report the new permission.
      if (state === 'active') sendStatus();
    });
    return () => sub.remove();
  }, [sendStatus]);

  // The Gmail connect flow runs in the system browser (Google refuses OAuth
  // inside a WebView). Render ends it on `mypro://gmail?...`, which reopens
  // the app here; hand the outcome to the web as the query its Settings reads.
  useEffect(() => {
    const open = (url: string | null) => {
      if (!url || !url.startsWith('mypro://gmail')) return;
      const query = url.split('?')[1] ?? '';
      const target = `${WEB_URL}/?${query}`;
      if (!loadedRef.current) {
        pendingNavigation.current = target;
        return;
      }
      webRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(target)}); true;`);
    };
    void Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', ({ url }) => open(url));
    return () => sub.remove();
  }, []);

  // Notification taps → the exact route the notification was about. One handles
  // the tap that launched the app (cold start), the other taps while it is
  // open. The route string was computed when the notification was armed (shared
  // `notificationHash`) and stored on it, so here we just open it.
  const handledLaunch = useRef<string | null>(null);
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const id = response?.notification.request.identifier ?? null;
      if (!id || handledLaunch.current === id) return;
      handledLaunch.current = id;
      openHash(hashOf(response));
    });
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openHash(hashOf(response));
    });
    return () => sub.remove();
  }, [openHash]);

  // The Android back button walks WebView history before leaving the app.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const onNavChange = useCallback((nav: WebViewNavigation) => {
    canGoBack.current = nav.canGoBack;
  }, []);

  const onLoadEnd = useCallback(() => {
    setLoaded(true);
    loadedRef.current = true;
    setFailed(false);
    if (pendingNavigation.current) {
      const target = pendingNavigation.current;
      pendingNavigation.current = null;
      webRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(target)}); true;`);
      return;
    }
    if (pendingDeepLink.current !== null) {
      const hash = pendingDeepLink.current;
      pendingDeepLink.current = null;
      // `loaded` is about to flip true; drive the hash directly rather than
      // through `openHash`, whose `loaded` is still the previous render's.
      webRef.current?.injectJavaScript(`window.location.hash = ${JSON.stringify(hash)}; true;`);
    }
  }, []);

  const reload = useCallback(() => {
    setFailed(false);
    setLoaded(false);
    loadedRef.current = false;
    setReloadKey((k) => k + 1);
  }, []);

  /**
   * Keep the web app and its own in-page navigations inside the WebView; send
   * everything else (OAuth consent, external links) to the system browser. A
   * new Chrome tab inside the app would break the illusion, but an auth flow
   * that ends on another origin genuinely belongs in the browser.
   */
  const webOrigin = originOf(WEB_URL);
  const onShouldStart = useCallback(
    (req: WebViewNavigation) => {
      const url = req.url ?? '';
      if (!url || url === 'about:blank' || url.startsWith('data:')) return true;
      if (originOf(url) === webOrigin) return true;
      void Linking.openURL(url).catch(() => undefined);
      return false;
    },
    [webOrigin],
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#000000', paddingTop: STATUS_BAR }}>
      <StatusBar style="light" />
      {failed ? (
        <ErrorScreen onReload={reload} />
      ) : (
        <WebView
          key={reloadKey}
          ref={webRef}
          source={{ uri: WEB_URL }}
          originWhitelist={['*']}
          injectedJavaScriptBeforeContentLoaded={INJECTED_BEFORE}
          onMessage={onMessage}
          onNavigationStateChange={onNavChange}
          onShouldStartLoadWithRequest={onShouldStart}
          onLoadEnd={onLoadEnd}
          onError={() => setFailed(true)}
          onHttpError={(e) => {
            // A 4xx/5xx on the top-level document means the app did not load;
            // in-page API calls that 401 are the web app's own concern.
            if (e.nativeEvent.url === WEB_URL) setFailed(true);
          }}
          // Persist the web app's session storage across launches, and keep
          // `_blank` navigations in-frame so they pass through the filter above.
          domStorageEnabled
          javaScriptEnabled
          thirdPartyCookiesEnabled
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures
          // Media: the WebView blocks playback until a user gesture and refuses
          // inline playback by default, which is exactly why the podcast player
          // (a YouTube embed) stayed silent in the app. Allow inline playback,
          // let a tap start it, and permit fullscreen for the video mode.
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          // The native clock owns pull-to-refresh behaviour; the web disables
          // overscroll in `.in-shell`.
          overScrollMode="never"
          style={{ flex: 1, backgroundColor: '#000000' }}
        />
      )}
      {!loaded && !failed ? (
        <View
          style={{
            position: 'absolute',
            top: STATUS_BAR,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000000',
          }}
          pointerEvents="none"
        >
          <ActivityIndicator color="#ffffff" />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The in-app route a notification response should open.
 *
 *  - **Local** notifications (the clock) carry a ready-made `hash`, built by the
 *    shared `notificationHash` when they were armed — down to a calendar event.
 *  - **Push** notifications (Expo, sent by the laptop) carry a `deeplink` path
 *    such as `/assistant`; the shared `hashFromDeeplink` maps it to a hash.
 *
 * Anything without either opens Today (the empty hash).
 */
function hashOf(response: Notifications.NotificationResponse | null): string {
  const data = response?.notification.request.content.data as
    | { hash?: unknown; deeplink?: unknown }
    | undefined;
  if (typeof data?.hash === 'string') return data.hash;
  return hashFromDeeplink(typeof data?.deeplink === 'string' ? data.deeplink : null);
}

/** The origin of a URL, or '' if it cannot be parsed. */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Shown when the top-level page fails to load (offline, or Render cold). */
function ErrorScreen({ onReload }: { onReload: () => void }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      <Text style={{ color: '#ffffff', fontSize: 20, fontWeight: '700' }}>Can’t reach MyPro</Text>
      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, textAlign: 'center' }}>
        Check your connection and try again. The server may also be waking up.
      </Text>
      <Pressable
        onPress={onReload}
        accessibilityRole="button"
        style={{
          marginTop: 8,
          paddingHorizontal: 22,
          paddingVertical: 12,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.4)',
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '600' }}>Reload</Text>
      </Pressable>
    </View>
  );
}

/** Shown when no web URL is configured — nothing can be loaded. */
function SetupScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000000', paddingTop: STATUS_BAR }}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 72, gap: 12 }}>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, letterSpacing: 1 }}>MYPRO</Text>
        <Text style={{ color: '#ffffff', fontSize: 26, fontWeight: '700' }}>Not configured yet.</Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, marginTop: 4 }}>
          Set EXPO_PUBLIC_WEB_URL to the deployed web app’s URL and rebuild. The shell loads that
          page; everything else — sign-in, your library, the assistant — runs inside it.
        </Text>
      </ScrollView>
    </View>
  );
}
