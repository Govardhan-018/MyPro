import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { isAgentConfigured, isApiConfigured, type AuthSession } from '@mypro/shared';
import { client } from './src/lib/client';
import { LibraryScreen, type BookSummary } from './src/screens/LibraryScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { colors, shared } from './src/theme';

/**
 * The Android app. Thin client: the only backend it configures is Render,
 * which brokers auth and the extracted-text URLs.
 *
 * What is here today is the reading path — sign in, your books, and the real
 * text of a book extracted on whichever device holds its PDF. The assistant
 * chat and the rest of the screens are Phase 8.
 */
export default function App() {
  const { env } = client;
  const apiReady = isApiConfigured(env);
  // `undefined` = still restoring the stored session.
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
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
      if (!next) setBook(null);
    });
    return () => {
      active = false;
      stop();
    };
  }, [apiReady]);

  if (!apiReady) return <SetupScreen />;

  if (session === undefined) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {!session ? (
        <SignInScreen onSignedIn={() => void client.auth.getSession().then(setSession)} />
      ) : book ? (
        <ReaderScreen book={book} onClose={() => setBook(null)} />
      ) : (
        <LibraryScreen onOpen={setBook} onSignOut={() => setSession(null)} />
      )}
    </>
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
