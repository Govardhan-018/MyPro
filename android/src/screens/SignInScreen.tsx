import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  Text, TextInput, View,
} from 'react-native';
import { client } from '../lib/client';
import { colors, shared } from '../theme';

/**
 * Email + password sign-in, brokered by Render (the thin-client model). Social
 * sign-in is deliberately absent: it is not wired on this path yet.
 */
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
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 96, gap: 16 }}>
        <Text style={shared.title}>MyPro</Text>
        <Text style={shared.muted}>
          {mode === 'in' ? 'Sign in to your companion.' : 'Create your account.'}
        </Text>

        <TextInput
          style={shared.input}
          placeholder="you@example.com"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={shared.input}
          placeholder="Password"
          placeholderTextColor={colors.textFaint}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error && <Text style={{ color: '#ff9c8a', fontSize: 13 }}>{error}</Text>}
        {notice && <Text style={shared.muted}>{notice}</Text>}

        <Pressable
          style={[shared.button, (busy || !email || !password) && { opacity: 0.5 }]}
          disabled={busy || !email || !password}
          onPress={submit}
        >
          {busy ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={shared.buttonLabel}>{mode === 'in' ? 'Sign in' : 'Create account'}</Text>
          )}
        </Pressable>

        <View style={{ alignItems: 'center', marginTop: 4 }}>
          <Pressable onPress={() => setMode(mode === 'in' ? 'up' : 'in')}>
            <Text style={shared.muted}>
              {mode === 'in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
