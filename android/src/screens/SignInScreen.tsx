/**
 * Sign in — the web login page, as a phone screen.
 *
 * Same journey and same copy as `frontend/src/App.tsx`'s `LoginScreen`: the
 * brand bar with the Color Mode toggle, the rolling-cubes mark, the welcome
 * copy with its three pillars, then the account panel — Apple, Google, or
 * email, with one feedback line that reports exactly what happened.
 *
 * Two deliberate differences, both so nothing here pretends:
 *  - the cubes are drawn with RN `Animated` rather than the web's Lottie file.
 *    Lottie on Android means a native module, and a new native module means
 *    the APK pipeline needs re-proving; this costs no dependency at all.
 *  - "Forgot password" says plainly that reset is not wired up yet, where the
 *    web still shows its prototype message.
 *
 * Apple and Google call the same shared `signInWithOAuth` the web calls, which
 * is honest about not being available in the thin-client model yet — the
 * buttons stay, and say so when tapped, exactly as they do in the browser.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, KeyboardAvoidingView,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isApiConfigured } from '@mypro/shared';
import { client } from '../lib/client';
import { FadeIn, type IconName } from '../components/ui';
import { colors, radius, space, type, useTheme } from '../theme';

type AuthState = 'idle' | 'loading' | 'error' | 'success';
type AccountMode = 'signin' | 'signup';

const PILLARS: { icon: IconName; title: string; subtitle: string }[] = [
  { icon: 'calendar-outline', title: 'Calendar', subtitle: 'Organize your time.' },
  { icon: 'library-outline', title: 'Library', subtitle: 'Keep your knowledge.' },
  { icon: 'heart-outline', title: 'Health', subtitle: 'Remember your history.' },
];

export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const { colorMode, setColorMode, accent } = useTheme();
  const configured = isApiConfigured(client.env);

  const [emailMode, setEmailMode] = useState(false);
  const [accountMode, setAccountMode] = useState<AccountMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [feedback, setFeedback] = useState('');

  const continueWithProvider = async (provider: 'google' | 'apple', label: string) => {
    setAuthState('loading');
    setFeedback(`Continuing with ${label}…`);
    try {
      await client.auth.signInWithOAuth(provider);
    } catch (error) {
      setAuthState('error');
      setFeedback(
        error instanceof Error ? error.message : `Could not continue with ${label}.`,
      );
    }
  };

  const submitEmail = async () => {
    if (!email.includes('@') || password.length < 6) {
      setAuthState('error');
      setFeedback('Enter a valid email and a password with at least 6 characters.');
      return;
    }
    setAuthState('loading');
    setFeedback(accountMode === 'signup' ? 'Creating your account…' : 'Signing you in…');
    try {
      if (accountMode === 'signup') {
        const session = await client.auth.signUpWithPassword(email.trim(), password);
        if (!session) {
          // Email confirmation is on: no session yet.
          setAuthState('success');
          setFeedback('Check your email to confirm your account, then sign in.');
          return;
        }
      } else {
        await client.auth.signInWithPassword(email.trim(), password);
      }
      setAuthState('success');
      setFeedback('Welcome. Opening your MyPro space…');
      onSignedIn();
    } catch (error) {
      setAuthState('error');
      setFeedback(error instanceof Error ? error.message : 'Authentication failed.');
    }
  };

  const openAccountMode = (mode: AccountMode) => {
    setAccountMode(mode);
    setEmailMode(true);
    setAuthState('idle');
    setFeedback('');
  };

  const busy = authState === 'loading';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand bar */}
        <FadeIn index={0}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingTop: 52,
              paddingBottom: space.sm,
              paddingHorizontal: space.gutter,
              gap: space.sm,
            }}
          >
            <Brand />
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => setColorMode(!colorMode)}
              accessibilityRole="switch"
              accessibilityState={{ checked: colorMode }}
              accessibilityLabel="Color Mode"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colorMode ? accent : colors.border,
                backgroundColor: colorMode ? 'rgba(168,140,242,0.12)' : colors.surface,
              }}
            >
              <Ionicons
                name="color-palette-outline"
                size={14}
                color={colorMode ? accent : colors.textMuted}
              />
              <Text
                style={{
                  color: colorMode ? accent : colors.textMuted,
                  fontSize: 12,
                  fontWeight: '500',
                }}
              >
                Color Mode
              </Text>
            </Pressable>
          </View>
        </FadeIn>

        {/* Introduction */}
        <View style={{ paddingHorizontal: space.gutter }}>
          <FadeIn index={1}>
            <RollingCubes />
          </FadeIn>

          <FadeIn index={2} style={{ gap: 8 }}>
            <Text style={type.eyebrow}>One intelligent space</Text>
            <Text
              style={{
                color: colors.text,
                fontSize: 38,
                fontWeight: '500',
                letterSpacing: -1.8,
                lineHeight: 42,
              }}
            >
              Welcome to MyPro
            </Text>
            <Text style={[type.meta, { maxWidth: 420 }]}>
              One intelligent space for your time, knowledge, and health.
            </Text>
          </FadeIn>

          <FadeIn index={3}>
            <View
              style={{
                flexDirection: 'row',
                marginTop: space.lg,
                paddingTop: space.md,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              }}
            >
              {PILLARS.map((pillar, index) => (
                <View
                  key={pillar.title}
                  style={{
                    flex: 1,
                    gap: 7,
                    paddingHorizontal: index === 0 ? 0 : 12,
                    borderLeftWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderLeftColor: colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 31,
                      height: 31,
                      borderRadius: 10,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: colorMode ? 'rgba(168,140,242,0.3)' : colors.borderStrong,
                      backgroundColor: colorMode
                        ? 'rgba(168,140,242,0.08)'
                        : 'rgba(255,255,255,0.04)',
                    }}
                  >
                    <Ionicons
                      name={pillar.icon}
                      size={15}
                      color={colorMode ? accent : colors.text}
                    />
                  </View>
                  <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600' }}>
                    {pillar.title}
                  </Text>
                  <Text style={{ color: colors.textFaint, fontSize: 11, lineHeight: 15 }}>
                    {pillar.subtitle}
                  </Text>
                </View>
              ))}
            </View>
          </FadeIn>
        </View>

        {/* Account panel */}
        <FadeIn index={4} style={{ paddingHorizontal: space.gutter, marginTop: space.lg }}>
          <View
            style={{
              padding: 22,
              borderRadius: radius.xl,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colorMode ? 'rgba(168,140,242,0.28)' : 'rgba(134,142,151,0.45)',
              backgroundColor: 'rgba(17,17,17,0.88)',
              elevation: 12,
              shadowColor: '#000',
              shadowOpacity: 0.45,
              shadowRadius: 24,
              shadowOffset: { width: 0, height: 12 },
            }}
          >
            <View style={{ gap: 6, marginBottom: 18 }}>
              <Text style={type.eyebrow}>MyPro account</Text>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 26,
                  fontWeight: '500',
                  letterSpacing: -1,
                }}
              >
                {accountMode === 'signup' ? 'Create your account.' : 'Welcome back.'}
              </Text>
              <Text style={type.meta}>
                {accountMode === 'signup'
                  ? 'Create your account to enter MyPro.'
                  : 'Sign in to continue with MyPro.'}
              </Text>
            </View>

            {/* One feedback line, as on the web */}
            {!!feedback && (
              <View
                accessibilityLiveRegion="polite"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 14,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: radius.md,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor:
                    authState === 'error'
                      ? 'rgba(242,145,126,0.4)'
                      : authState === 'success'
                        ? 'rgba(143,214,168,0.35)'
                        : colors.border,
                  backgroundColor:
                    authState === 'error'
                      ? 'rgba(242,145,126,0.08)'
                      : 'rgba(255,255,255,0.03)',
                }}
              >
                {authState === 'loading' && (
                  <ActivityIndicator size="small" color={colors.textMuted} />
                )}
                {authState === 'success' && (
                  <Ionicons name="checkmark-circle" size={15} color="#8FD6A8" />
                )}
                {authState === 'error' && (
                  <Ionicons name="alert-circle" size={15} color={colors.danger} />
                )}
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12.5,
                    lineHeight: 18,
                    color: authState === 'error' ? colors.danger : colors.textStrong,
                  }}
                >
                  {feedback}
                </Text>
              </View>
            )}

            <AuthButton
              label="Continue with Apple"
              icon="logo-apple"
              primary
              disabled={busy}
              onPress={() => void continueWithProvider('apple', 'Apple')}
            />
            <AuthButton
              label="Continue with Google"
              icon="logo-google"
              disabled={busy}
              onPress={() => void continueWithProvider('google', 'Google')}
            />

            {/* Separator */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                marginVertical: 13,
              }}
            >
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
              <Text style={{ color: colors.textFaint, fontSize: 11.5 }}>or</Text>
              <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
            </View>

            {!emailMode ? (
              <AuthButton
                label="Continue with Email"
                icon="mail-outline"
                disabled={busy}
                onPress={() => setEmailMode(true)}
              />
            ) : (
              <View style={{ gap: 12 }}>
                <View style={{ gap: 7 }}>
                  <Text style={type.label}>Email address</Text>
                  <TextInput
                    style={fieldStyle}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                    accessibilityLabel="Email address"
                  />
                </View>

                <View style={{ gap: 7 }}>
                  <Text style={type.label}>Password</Text>
                  <View style={{ justifyContent: 'center' }}>
                    <TextInput
                      style={[fieldStyle, { paddingRight: 46 }]}
                      placeholder="Enter your password"
                      placeholderTextColor={colors.textFaint}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoComplete={
                        accountMode === 'signup' ? 'new-password' : 'current-password'
                      }
                      value={password}
                      onChangeText={setPassword}
                      onSubmitEditing={() => void submitEmail()}
                      returnKeyType="go"
                      accessibilityLabel="Password"
                    />
                    <Pressable
                      onPress={() => setShowPassword((visible) => !visible)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                      style={{
                        position: 'absolute',
                        right: 6,
                        width: 34,
                        height: 34,
                        borderRadius: 9,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Ionicons
                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                        size={17}
                        color={colors.textMuted}
                      />
                    </Pressable>
                  </View>
                </View>

                {accountMode === 'signin' && (
                  <Pressable
                    onPress={() => {
                      setAuthState('idle');
                      setFeedback(
                        'Password reset is not wired up yet — it needs an email link from the server.',
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Forgot password"
                    style={{ alignSelf: 'flex-end' }}
                  >
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                      Forgot password?
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  onPress={() => void submitEmail()}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={accountMode === 'signup' ? 'Create account' : 'Sign in'}
                  style={({ pressed }) => ({
                    height: 46,
                    borderRadius: 11,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.text,
                    opacity: busy ? 0.65 : pressed ? 0.88 : 1,
                  })}
                >
                  <Text style={{ color: colors.background, fontSize: 14.5, fontWeight: '700' }}>
                    {busy
                      ? 'Please wait…'
                      : accountMode === 'signup'
                        ? 'Create account'
                        : 'Sign in'}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Account switch */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                gap: 5,
                marginTop: 17,
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>
                {accountMode === 'signup' ? 'Already have an account?' : 'New to MyPro?'}
              </Text>
              <Pressable
                onPress={() => openAccountMode(accountMode === 'signup' ? 'signin' : 'signup')}
                accessibilityRole="button"
                accessibilityLabel={
                  accountMode === 'signup' ? 'Sign in' : 'Create an account'
                }
              >
                <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600' }}>
                  {accountMode === 'signup' ? 'Sign in' : 'Create an account'}
                </Text>
              </Pressable>
            </View>

            <Text
              style={{
                color: colors.textFaint,
                fontSize: 11,
                lineHeight: 16,
                textAlign: 'center',
                marginTop: 14,
              }}
            >
              By continuing, you agree to the Terms of Service and Privacy Policy.
            </Text>

            {!configured && (
              <Text
                style={{
                  color: colors.textFaint,
                  fontSize: 11,
                  lineHeight: 16,
                  textAlign: 'center',
                  marginTop: 10,
                }}
              >
                This build has no API URL, so sign-in cannot reach the server yet.
              </Text>
            )}
          </View>
        </FadeIn>

        {/* Footer */}
        <FadeIn index={5}>
          <View
            style={{
              marginTop: space.lg,
              marginHorizontal: space.gutter,
              paddingTop: space.md,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ color: colors.textFaint, fontSize: 12, fontWeight: '600' }}>
              MyPro
            </Text>
            <Text
              style={{
                color: colors.textFaint,
                fontSize: 10,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
              }}
            >
              Time · Knowledge · Health
            </Text>
          </View>
        </FadeIn>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const fieldStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 11,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: colors.text,
  fontSize: 15,
  backgroundColor: 'rgba(255,255,255,0.04)',
} as const;

/**
 * A provider button. `primary` is the white fill the web gives Apple; the rest
 * are the translucent ghost treatment.
 */
function AuthButton({
  label,
  icon,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        height: 46,
        marginBottom: 9,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        borderRadius: 11,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: primary ? colors.text : colors.borderStrong,
        backgroundColor: primary
          ? colors.text
          : pressed
            ? 'rgba(255,255,255,0.1)'
            : 'rgba(255,255,255,0.055)',
        opacity: disabled ? 0.65 : primary && pressed ? 0.9 : 1,
      })}
    >
      <Ionicons name={icon} size={17} color={primary ? colors.background : colors.text} />
      <Text
        style={{
          color: primary ? colors.background : colors.text,
          fontSize: 14,
          fontWeight: primary ? '700' : '500',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The orbital mark and wordmark, as in the web header. */
function Brand() {
  const { colorMode, accent } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 1.5,
          borderColor: colorMode ? accent : colors.textMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: colorMode ? accent : colors.text,
          }}
        />
      </View>
      <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: 0.2 }}>
        MyPro
      </Text>
    </View>
  );
}

/**
 * The login mark: three cubes that drop in, then drift on a slow loop — the
 * web's Lottie animation rebuilt with the Animated API so the app needs no
 * native animation module. Still, with reduce-motion on it simply holds its
 * settled pose.
 */
function RollingCubes() {
  const { colorMode, accent } = useTheme();
  const drop = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (!active) return;
        if (on) {
          drop.setValue(1);
          return;
        }
        Animated.timing(drop, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }).start(() => {
          if (!active) return;
          Animated.loop(
            Animated.sequence([
              Animated.timing(drift, {
                toValue: 1,
                duration: 2600,
                easing: Easing.inOut(Easing.sin),
                useNativeDriver: true,
              }),
              Animated.timing(drift, {
                toValue: 0,
                duration: 2600,
                easing: Easing.inOut(Easing.sin),
                useNativeDriver: true,
              }),
            ]),
          ).start();
        });
      })
      .catch(() => drop.setValue(1));
    return () => {
      active = false;
    };
  }, [drop, drift]);

  const cubes = [
    { size: 46, left: 4, delay: 0, rotate: '-12deg' },
    { size: 34, left: 58, delay: 0.15, rotate: '8deg' },
    { size: 26, left: 100, delay: 0.3, rotate: '-4deg' },
  ];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 112, marginTop: 4, marginBottom: 10, justifyContent: 'flex-end' }}
    >
      {cubes.map((cube, index) => (
        <Animated.View
          key={index}
          style={{
            position: 'absolute',
            left: cube.left,
            bottom: 10,
            width: cube.size,
            height: cube.size,
            borderRadius: cube.size * 0.28,
            borderWidth: 1,
            borderColor: colorMode ? 'rgba(168,140,242,0.45)' : colors.borderStrong,
            backgroundColor: colorMode ? 'rgba(168,140,242,0.1)' : 'rgba(255,255,255,0.05)',
            opacity: drop,
            transform: [
              { rotate: cube.rotate },
              {
                /* With reduce-motion on, `drop` is set straight to 1 and
                   `drift` never starts, so this resolves to the settled 0. */
                translateY: Animated.add(
                  drop.interpolate({ inputRange: [0, 1], outputRange: [-70, 0] }),
                  drift.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -6 + index * 2],
                  }),
                ),
              },
            ],
          }}
        >
          {index === 0 && (
            <View
              style={{
                position: 'absolute',
                top: 9,
                left: 9,
                width: 9,
                height: 9,
                borderRadius: 5,
                backgroundColor: colorMode ? accent : 'rgba(255,255,255,0.55)',
              }}
            />
          )}
        </Animated.View>
      ))}
    </View>
  );
}
