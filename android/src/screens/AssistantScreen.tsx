/**
 * AI Assistant — the web app's assistant view, as a phone screen.
 *
 * Same words as `AssistantView` in `frontend/src/App.tsx`: the "YOUR
 * COMPANION" kicker over "Hi, how can I help you today?", the conversation,
 * and the composer with its privacy line beneath.
 *
 * All assistant traffic goes straight to the laptop, not through Render: it
 * is the only machine holding the model key. So this screen has a state the
 * others do not — the agent being unreachable — and it says so in the
 * composer exactly as the browser does, while the rest of the app keeps
 * working.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AgentOfflineError, type AssistantMessageRow } from '@mypro/shared';
import { client } from '../lib/client';
import { FadeIn, Kicker, Loading } from '../components/ui';
import { colors, radius, shared, space, type, useTheme } from '../theme';

/** One-tap starters, shown while the conversation is still empty. */
const SUGGESTIONS = [
  'Plan my day',
  'Summarize my current book',
  'What did I highlight this week?',
];

export function AssistantScreen() {
  const { accent, colorMode } = useTheme();
  const [messages, setMessages] = useState<AssistantMessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<AssistantMessageRow>>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await client.api.assistant.messages(50);
      // The API returns newest-first; an inverted list wants the same order.
      setMessages(rows);
      setOffline(false);
    } catch (caught) {
      if (caught instanceof AgentOfflineError) {
        setOffline(true);
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not reach your companion.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (text?: string) => {
    const content = (text ?? draft).trim();
    if (!content || sending || offline) return;
    setDraft('');
    setSending(true);

    // Show it immediately; a chat that waits for a round trip feels broken.
    const pending: AssistantMessageRow = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    };
    setMessages((current) => [pending, ...current]);

    try {
      await client.api.assistant.send(content);
      await load();
    } catch (caught) {
      if (caught instanceof AgentOfflineError) setOffline(true);
      else setError(caught instanceof Error ? caught.message : 'Could not send that.');
      // Put the text back rather than losing it.
      setMessages((current) => current.filter((m) => m.id !== pending.id));
      setDraft(content);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Loading />;

  const empty = messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={shared.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* `.assistant-center` — the intro sits above an empty conversation. */}
      {empty ? (
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: space.gutter,
            paddingVertical: space.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <FadeIn index={0} style={{ alignItems: 'center', gap: 10 }}>
            <Cubes />
            <Kicker>Your companion</Kicker>
            <Text
              style={{
                color: colors.text,
                fontSize: 27,
                lineHeight: 31,
                fontWeight: '500',
                letterSpacing: -1.2,
                textAlign: 'center',
              }}
            >
              Hi, how can I help you today?
            </Text>
            <Text
              style={{
                color: colors.textBody,
                fontSize: 14,
                lineHeight: 21,
                textAlign: 'center',
                maxWidth: 300,
              }}
            >
              I can organize your time, knowledge, and health — all in one thoughtful space.
            </Text>
          </FadeIn>

          {!offline && (
            <FadeIn index={1} style={{ marginTop: space.lg, gap: 8 }}>
              {SUGGESTIONS.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => void send(suggestion)}
                  accessibilityRole="button"
                  accessibilityLabel={suggestion}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    justifyContent: 'center',
                    paddingHorizontal: 16,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : colors.surface,
                  })}
                >
                  <Text style={{ color: colors.textMuted, fontSize: 14 }}>{suggestion}</Text>
                </Pressable>
              ))}
            </FadeIn>
          )}
        </ScrollView>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          /* Inverted so new messages appear at the bottom without measuring. */
          inverted
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: space.gutter,
            paddingTop: 16,
            paddingBottom: 16,
            gap: 10,
          }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            sending ? (
              <View
                style={{
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  borderRadius: radius.card,
                  paddingHorizontal: 14,
                  paddingVertical: 11,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                }}
              >
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={type.meta}>Thinking…</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => <Bubble message={item} />}
        />
      )}

      {/* `.composer` */}
      <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.borderStrong,
            borderRadius: 22,
            backgroundColor: colors.surface,
            paddingHorizontal: 13,
            paddingTop: 10,
            paddingBottom: 9,
            opacity: offline ? 0.55 : 1,
          }}
        >
          <TextInput
            style={{
              minHeight: 40,
              maxHeight: 120,
              color: colors.text,
              fontSize: 16,
              paddingHorizontal: 5,
              paddingVertical: 3,
              textAlignVertical: 'top',
            }}
            placeholder={offline ? 'Your laptop agent is asleep…' : 'Ask MyPro anything...'}
            placeholderTextColor="rgba(255,255,255,0.44)"
            value={draft}
            onChangeText={setDraft}
            multiline
            editable={!offline && !sending}
            accessibilityLabel="Message"
          />
          {/* `.composer-tools` */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-end',
              marginTop: 4,
            }}
          >
            <Pressable
              onPress={() => void send()}
              disabled={!draft.trim() || sending || offline}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor:
                  draft.trim() && !sending && !offline
                    ? colorMode
                      ? accent
                      : colors.text
                    : 'rgba(255,255,255,0.08)',
              }}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <Ionicons
                  name="send"
                  size={16}
                  color={
                    draft.trim() && !offline ? '#000000' : 'rgba(255,255,255,0.4)'
                  }
                />
              )}
            </Pressable>
          </View>
        </View>

        {/* The line beneath the composer, as the web writes it. */}
        <Text
          style={{
            marginTop: 8,
            marginHorizontal: 6,
            color: error ? colors.danger : colors.textFaint,
            fontSize: 12,
            lineHeight: 17,
          }}
        >
          {error
            ? error
            : offline
              ? 'Wake your laptop to chat with your companion. Everything else keeps working.'
              : 'MyPro keeps your personal data private and under your control.'}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

/** `.message` + `.message-bubble`. */
function Bubble({ message }: { message: AssistantMessageRow }) {
  const { accent, colorMode } = useTheme();
  const mine = message.role === 'user';
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        borderRadius: radius.card,
        borderBottomRightRadius: mine ? 6 : radius.card,
        borderBottomLeftRadius: mine ? radius.card : 6,
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderWidth: 1,
        borderColor: mine && colorMode ? 'rgba(182,154,245,0.35)' : colors.border,
        backgroundColor: mine
          ? colorMode
            ? 'rgba(182,154,245,0.12)'
            : 'rgba(255,255,255,0.1)'
          : colors.surface,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 14.5, lineHeight: 22 }}>
        {message.content ?? ''}
      </Text>
      {!mine && colorMode && (
        <View
          style={{
            position: 'absolute',
            left: -1,
            top: 14,
            bottom: 14,
            width: 2,
            borderTopRightRadius: 2,
            borderBottomRightRadius: 2,
            backgroundColor: accent,
          }}
        />
      )}
    </View>
  );
}

/**
 * `.rolling-cubes` — the web plays a Lottie animation here. Native Lottie
 * would mean a new native module and a re-proved APK pipeline, so this is its
 * still cousin: three stacked tiles that pick up the accent in Color Mode.
 */
function Cubes() {
  const { colorMode, accent } = useTheme();
  const tile = (size: number, offset: number, rotate: string) => (
    <View
      key={`${size}-${offset}`}
      style={{
        position: 'absolute',
        left: offset,
        bottom: 0,
        width: size,
        height: size,
        borderRadius: size * 0.28,
        borderWidth: 1,
        borderColor: colorMode ? 'rgba(182,154,245,0.45)' : colors.borderStrong,
        backgroundColor: colorMode ? 'rgba(168,140,242,0.1)' : 'rgba(255,255,255,0.05)',
        transform: [{ rotate }],
      }}
    />
  );
  return (
    <View style={{ width: 150, height: 78, marginBottom: 14 }}>
      {tile(52, 6, '-12deg')}
      {tile(40, 62, '8deg')}
      {tile(30, 108, '-4deg')}
      <View
        style={{
          position: 'absolute',
          left: 22,
          bottom: 18,
          width: 12,
          height: 12,
          borderRadius: 6,
          backgroundColor: colorMode ? accent : 'rgba(255,255,255,0.55)',
        }}
      />
    </View>
  );
}
