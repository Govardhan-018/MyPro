import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, AppState, ScrollView, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { isAgentConfigured, isApiConfigured, type AuthSession } from '@mypro/shared';
import { client } from './src/lib/client';
import { armUpcoming, registerForPush } from './src/lib/notifications';
import { TabBar, type Tab } from './src/components/TabBar';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { CalendarScreen } from './src/screens/CalendarScreen';
import { HealthScreen } from './src/screens/HealthScreen';
import { KnowledgeScreen } from './src/screens/KnowledgeScreen';
import { LibraryScreen, type BookSummary } from './src/screens/LibraryScreen';
import { MoreScreen } from './src/screens/MoreScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { colors, shared } from './src/theme';

/** Pushed on top of a tab, with its own close button rather than a back stack. */
type Overlay = 'health' | 'knowledge' | null;

/**
 * The Android app. Thin client: the only backend it configures is Render,
 * which brokers auth, the extracted-text URLs and the occurrence list.
 *
 * Since Phase 11 this app is also **the clock**. Render's free instance sleeps
 * and the laptop gets shut, but Android's alarm manager is awake for nothing,
 * so scheduled notifications are armed locally for the next 48 hours and
 * re-armed every time the app comes to the foreground. That is the whole
 * reason the morning brief arrives at 08:30 with everything else off.
 */
export default function App() {
  const { env } = client;
  const apiReady = isApiConfigured(env);
  // `undefined` = still restoring the stored session.
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('today');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [book, setBook] = useState<BookSummary | null>(null);

  useEffect(() => {
    if (!apiReady) return;
    let active = true;
    client.auth
      .getSession()
      .then((current) => {
        if (active) setSession(current);
      })
      .catch(() => {
        if (active) setSession(null);
      });
    const stop = client.auth.onAuthChange((next) => {
      if (!active) return;
      setSession(next);
      if (!next) {
        setBook(null);
        setOverlay(null);
        setTab('today');
      }
    });
    return () => {
      active = false;
      stop();
    };
  }, [apiReady]);

  /**
   * Arm the clock (Phase 11.2) — on sign-in, and again whenever the app
   * returns to the foreground.
   *
   * Re-arming on foreground rather than only on cold start is what keeps the
   * 48-hour window rolling: Android may keep this process alive for days, and
   * a schedule created on the laptop this afternoon has to reach the phone
   * before its first occurrence.
   */
  useEffect(() => {
    if (!session) return;

    void armUpcoming();
    // Push is for what nobody could schedule in advance. It needs an EAS
    // project id, so it is allowed to fail quietly — the clock above does not
    // depend on it.
    void registerForPush();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void armUpcoming();
    });
    return () => subscription.remove();
  }, [session]);

  /** Tapping a notification should land on the thing it was about. */
  const tapped = useRef<string | null>(null);
  useEffect(() => {
    if (!session) return;

    const open = (deeplink: unknown) => {
      if (deeplink === 'assistant') setTab('assistant');
      else if (deeplink === 'calendar') setTab('calendar');
      else setTab('today');
    };

    // The notification that launched the app, if any — this resolves once and
    // keeps resolving to the same value, so guard against re-handling it.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const id = response?.notification.request.identifier ?? null;
      if (!id || tapped.current === id) return;
      tapped.current = id;
      open(response?.notification.request.content.data?.deeplink);
    });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      tapped.current = response.notification.request.identifier;
      open(response.notification.request.content.data?.deeplink);
    });
    return () => subscription.remove();
  }, [session]);

  if (!apiReady) return <SetupScreen />;

  if (session === undefined) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (!session) {
    return (
      <>
        <StatusBar style="light" />
        <SignInScreen onSignedIn={() => void client.auth.getSession().then(setSession)} />
      </>
    );
  }

  // The reader is full-screen: it is the one place the tab bar would be in the
  // way rather than useful.
  if (book) {
    return (
      <>
        <StatusBar style="light" />
        <ReaderScreen book={book} onClose={() => setBook(null)} />
      </>
    );
  }

  return (
    <View style={shared.screen}>
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
        {overlay === 'health' ? (
          <HealthScreen />
        ) : overlay === 'knowledge' ? (
          <KnowledgeScreen />
        ) : tab === 'today' ? (
          <TodayScreen onOpenBook={setBook} />
        ) : tab === 'library' ? (
          <LibraryScreen onOpen={setBook} />
        ) : tab === 'assistant' ? (
          <AssistantScreen />
        ) : tab === 'calendar' ? (
          <CalendarScreen />
        ) : (
          <MoreScreen onOpen={setOverlay} onSignOut={() => setSession(null)} />
        )}
      </View>
      <TabBar
        active={tab}
        onChange={(next) => {
          // Any tab press closes an overlay — that is the back gesture here.
          setOverlay(null);
          setTab(next);
        }}
      />
    </View>
  );
}

/** Shown when the build has no API URL — nothing can be reached yet. */
function SetupScreen() {
  const { env } = client;
  return (
    <View style={shared.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 72, gap: 20 }}>
        <Text style={shared.title}>MyPro</Text>
        <Text style={shared.muted}>Personal companion — Android</Text>

        <View style={shared.card}>
          <Text
            style={{
              color: colors.text,
              fontSize: 13,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            Not configured
          </Text>
          <Text style={shared.muted}>
            Set EXPO_PUBLIC_API_URL to your Render URL and rebuild. That is the only
            backend this app needs — sign-in, your library and the extracted book text
            all come through it.
          </Text>
          <Text style={{ color: colors.textFaint, fontSize: 12 }}>
            Assistant (laptop agent): {isAgentConfigured(env) ? 'discoverable' : 'not set'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
