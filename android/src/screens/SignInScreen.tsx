/**
 * Email + password sign-in, brokered by Render (the thin-client model). Social
 * sign-in is deliberately absent: it is not wired on this path yet.
 */
import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  Text, TextInput, View,
} from 'react-native';
import { client } from '../lib/client';
import { FadeIn } from '../components/ui';
import { colors, shared, space, type } from '../theme';

export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const session =
        mode === 'in'
          ? await client.auth.signInWithPassword(email.trim(), password)
          : await client.auth.signUpWithPassword(email.trim(), password);
      if (session) onSignedIn();
      else setNotice('Check your email to confirm the account, then sign in.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={shared.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: 110, gap: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <FadeIn index={0} style={{ gap: 10, marginBottom: 10 }}>
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              borderWidth: 2,
              borderColor: colors.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.text }}
            />
          </View>
          <Text style={type.title}>MyPro</Text>
          <Text style={type.support}>
            {mode === 'in'
              ? 'Welcome back. Sign in to your companion.'
              : 'Create your account to get started.'}
          </Text>
        </FadeIn>

        <FadeIn index={1} style={{ gap: 12 }}>
          <TextInput
            style={shared.input}
            placeholder="you@example.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            accessibilityLabel="Email"
          />
          <TextInput
            style={shared.input}
            placeholder="Password"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            accessibilityLabel="Password"
          />

          {error && <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>}
          {notice && <Text style={type.support}>{notice}</Text>}

          <Pressable
            style={[shared.button, (busy || !email || !password) && { opacity: 0.5 }]}
            disabled={busy || !email || !password}
            onPress={submit}
            accessibilityRole="button"
            accessibilityLabel={mode === 'in' ? 'Sign in' : 'Create account'}
          >
            {busy ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={shared.buttonLabel}>{mode === 'in' ? 'Sign in' : 'Create account'}</Text>
            )}
          </Pressable>
        </FadeIn>

        <FadeIn index={2} style={{ alignItems: 'center', marginTop: 4 }}>
          <Pressable
            onPress={() => setMode(mode === 'in' ? 'up' : 'in')}
            accessibilityRole="button"
            accessibilityLabel={mode === 'in' ? 'Create an account instead' : 'Sign in instead'}
          >
            <Text style={type.support}>
              {mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </FadeIn>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
