import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  AppState, Image, Platform, Pressable, ScrollView, StatusBar as RNStatusBar, View,
} from 'react-native';
import { Text } from './src/components/Typography';
import * as Notifications from 'expo-notifications';
import {
  DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, useFonts,
} from '@expo-google-fonts/dm-sans';
import { Ionicons } from '@expo/vector-icons';
import { isAgentConfigured, isApiConfigured, type AuthSession } from '@mypro/shared';
import { client } from './src/lib/client';
import { armUpcoming, registerForPush } from './src/lib/notifications';
import { NAV_COLLAPSED_HEIGHT, TabBar, type View_ } from './src/components/TabBar';
import { Card, Glass, Loading, ToastProvider } from './src/components/ui';
import { AssistantScreen } from './src/screens/AssistantScreen';
import { CalendarScreen } from './src/screens/CalendarScreen';
import { HealthScreen } from './src/screens/HealthScreen';
import { KnowledgeScreen } from './src/screens/KnowledgeScreen';
import { LibraryScreen, type BookSummary } from './src/screens/LibraryScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { SchedulesScreen } from './src/screens/SchedulesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { TodayScreen } from './src/screens/TodayScreen';
import { colors, shared, space, ThemeProvider, type, useTheme } from './src/theme';

/**
 * The Android app. Thin client: the only backend it configures is Render,
 * which brokers auth, the extracted-text URLs and the occurrence list.
 *
 * Since Phase 11 this app is also **the clock**. Render's free instance sleeps
 * and the laptop gets shut, but Android's alarm manager is awake for nothing,
 * so scheduled notifications are armed locally for the next 48 hours and
 * re-armed every time the app comes to the foreground. That is the whole
 * reason the morning brief arrives at 08:30 with everything else off.
 *
 * The shell mirrors the web app's phone layout: a 58px header carrying the
 * wordmark and the two global controls, the scrolling view beneath it, and
 * the navigation sheet pinned to the bottom.
 */
export default function App() {
  /**
   * DM Sans is the web app's typeface, so the phone waits for it rather than
   * painting a frame in Roboto and snapping. The faces are bundled, not
   * fetched, so this resolves on the first tick.
   */
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <ThemeProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </ThemeProvider>
  );
}

/** Settings is reached from the header and the nav drawer, not a tab. */
type Screen = View_ | 'settings';

function Root() {
  const { env } = client;
  const apiReady = isApiConfigured(env);
  // `undefined` = still restoring the stored session.
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [view, setView] = useState<Screen>('today');
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
        setView('today');
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
      if (deeplink === 'assistant') setView('assistant');
      else if (deeplink === 'calendar') setView('calendar');
      else setView('today');
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

  const signOut = async () => {
    await client.auth.signOut().catch(() => undefined);
    setSession(null);
  };

  if (!apiReady) return <SetupScreen />;

  if (session === undefined) {
    return (
      <>
        <StatusBar style="light" />
        <Loading />
      </>
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

  // The reader is full-screen and distraction-free: no app chrome at all.
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

      <MobileHeader
        settingsActive={view === 'settings'}
        onOpenSettings={() => setView((current) => (current === 'settings' ? 'today' : 'settings'))}
      />

      <View style={{ flex: 1, paddingBottom: NAV_COLLAPSED_HEIGHT }}>
        {view === 'today' ? (
          <TodayScreen
            onOpenBook={setBook}
            onNavigate={(next) => setView(next)}
          />
        ) : view === 'calendar' ? (
          <CalendarScreen />
        ) : view === 'assistant' ? (
          <AssistantScreen />
        ) : view === 'library' ? (
          <LibraryScreen onOpen={setBook} />
        ) : view === 'knowledge' ? (
          <KnowledgeScreen />
        ) : view === 'health' ? (
          <HealthScreen />
        ) : view === 'schedules' ? (
          <SchedulesScreen />
        ) : (
          <SettingsScreen
            onNavigate={(next) => setView(next)}
            onSignOut={() => void signOut()}
          />
        )}
      </View>

      <TabBar
        active={view === 'settings' ? 'today' : view}
        onChange={(next) => setView(next)}
        onOpenSettings={() => setView('settings')}
        onSignOut={() => void signOut()}
      />
    </View>
  );
}

/**
 * The status-bar inset — the native stand-in for the web's
 * `env(safe-area-inset-top)`, which the header and its padding are built on.
 */
const STATUS_BAR = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 24) : 44;

/**
 * `.mobile-header` — 58px plus the status bar, the wordmark on the left and
 * the two global controls on the right.
 */
function MobileHeader({
  settingsActive,
  onOpenSettings,
}: {
  settingsActive: boolean;
  onOpenSettings: () => void;
}) {
  const { colorMode, setColorMode, accent } = useTheme();
  return (
    <Glass
      intensity={40}
      tint={colors.header}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 58 + STATUS_BAR,
        paddingTop: STATUS_BAR,
        paddingHorizontal: space.gutter,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.06)',
      }}
    >
      <Brand />
      {/* `.mobile-header-actions` — two 40px circles. */}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <HeaderButton
          icon="color-palette-outline"
          label="Toggle Color Mode"
          active={colorMode}
          accent={accent}
          colorMode={colorMode}
          onPress={() => setColorMode(!colorMode)}
        />
        <HeaderButton
          icon="settings-outline"
          label="Open settings"
          active={settingsActive}
          accent={accent}
          colorMode={colorMode}
          onPress={onOpenSettings}
        />
      </View>
    </Glass>
  );
}

/** `.mobile-header-button`, with the Color Mode active treatment. */
function HeaderButton({
  icon,
  label,
  active,
  accent,
  colorMode,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  accent: string;
  colorMode: boolean;
  onPress: () => void;
}) {
  const tint = active ? (colorMode ? accent : colors.text) : 'rgba(255,255,255,0.82)';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: active
          ? colorMode
            ? 'rgba(182,154,245,0.45)'
            : 'rgba(255,255,255,0.4)'
          : colors.borderStrong,
        backgroundColor: active
          ? colorMode
            ? 'rgba(145,104,220,0.14)'
            : colors.surfaceActive
          : colors.surface,
      }}
    >
      <Ionicons name={icon} size={18} color={tint} />
    </Pressable>
  );
}

/**
 * `.brand` — the web app's own wordmark asset, so the two clients carry the
 * same mark rather than a lookalike. Color Mode cross-fades to the colour
 * logo exactly as the browser does.
 */
function Brand() {
  const { colorMode } = useTheme();
  return (
    <View style={{ width: 92, height: 34, justifyContent: 'center' }}>
      <Image
        source={require('./assets/mypro-logo-light.png')}
        style={{ width: 92, height: 34, opacity: colorMode ? 0 : 1 }}
        resizeMode="contain"
        accessibilityLabel="MyPro"
      />
      <Image
        source={require('./assets/mypro-logo-color.png')}
        style={{
          position: 'absolute',
          width: 92,
          height: 34,
          opacity: colorMode ? 1 : 0,
        }}
        resizeMode="contain"
        accessible={false}
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
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 92, gap: space.md }}>
        <Text style={type.eyebrow}>MyPro</Text>
        <Text style={type.h1}>Not configured yet.</Text>
        <Text style={type.lede}>Personal companion — Android</Text>

        <Card style={{ gap: 10, marginTop: space.sm }}>
          <Text style={type.kicker}>Missing API URL</Text>
          <Text style={type.body}>
            Set EXPO_PUBLIC_API_URL to your Render URL and rebuild. That is the only backend this
            app needs — sign-in, your library and the extracted book text all come through it.
          </Text>
          <Text style={type.meta}>
            Assistant (laptop agent): {isAgentConfigured(env) ? 'discoverable' : 'not set'}
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}
