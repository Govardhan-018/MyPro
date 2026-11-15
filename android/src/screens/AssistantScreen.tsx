/**
 * The assistant — MyPro's most distinctive surface. MYPRO 2.0.
 *
 * All assistant traffic goes straight to the laptop, not through Render: it
 * is the only machine holding the model key. So this screen has a state the
 * others do not — the agent being unreachable — and it explains that in plain
 * language instead of an ambiguous "asleep" badge, while the rest of the app
 * keeps working.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AgentOfflineError, type AssistantMessageRow } from '@mypro/shared';
import { client } from '../lib/client';
import { Card, EmptyState, FadeIn } from '../components/ui';
import { colors, radius, shared, space, type, useTheme } from '../theme';

/** One-tap starters, shown while the conversation is young. */
const SUGGESTIONS = [
  'Plan my day',
  'Summarize my current book',
  'Create a task for tomorrow',
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
    if (!content || sending) return;
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

  if (loading) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (offline) {
    return (
      <ScrollView
        style={shared.screen}
        contentContainerStyle={{ padding: space.gutter, paddingTop: 8, gap: space.md }}
      >
        <FadeIn index={0} style={{ gap: 4 }}>
          <Text style={type.title}>Assistant</Text>
          <StatusPill online={false} />
        </FadeIn>
        <FadeIn index={1}>
          <Card elevated style={{ gap: 10 }}>
            <Text style={type.cardTitle}>Not reachable right now</Text>
            <Text style={type.body}>
              Your assistant runs at home, on the only machine that holds the AI key — and that
              machine isn't reachable at the moment.
            </Text>
            <Text style={type.support}>
              Everything else in MyPro keeps working: your calendar, library, reading and health
              records all live on the always-on server. Open the laptop and the conversation
              picks up exactly where it left off.
            </Text>
            <Pressable
              style={[shared.ghostButton, { marginTop: 6 }]}
              onPress={() => void load()}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <Text style={shared.ghostLabel}>Try again</Text>
            </Pressable>
          </Card>
        </FadeIn>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={shared.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={{
          paddingHorizontal: space.gutter,
          paddingTop: 8,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Text style={[type.title, { flex: 1 }]}>Assistant</Text>
        <StatusPill online />
      </View>

      {error && (
        <View style={{ paddingHorizontal: space.gutter, paddingBottom: 10 }}>
          <Text style={{ color: colors.danger, fontSize: 12.5 }}>{error}</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        /* Inverted so new messages appear at the bottom without measuring. */
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: 16, gap: 10 }}
        ListEmptyComponent={
          /* An inverted empty list renders right-side-up content upside down,
             so flip it back. */
          <View style={{ transform: [{ scaleY: -1 }], paddingTop: 20 }}>
            <EmptyState
              icon="sparkles-outline"
              title="Your companion"
              body="It knows your calendar, your library and your notes — and it remembers. Start anywhere."
            />
          </View>
        }
        ListHeaderComponent={
          sending ? (
            <View
              style={{
                alignSelf: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                borderRadius: radius.lg,
                paddingHorizontal: 14,
                paddingVertical: 10,
                backgroundColor: colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
              }}
            >
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={type.support}>Thinking…</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => <Bubble message={item} />}
      />

      {/* Suggestions appear while the thread is young. */}
      {messages.length < 3 && !sending && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, paddingHorizontal: space.gutter, paddingVertical: 8 }}
          style={{ flexGrow: 0 }}
        >
          {SUGGESTIONS.map((suggestion) => (
            <Pressable
              key={suggestion}
              onPress={() => void send(suggestion)}
              accessibilityRole="button"
              accessibilityLabel={suggestion}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: colors.surface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.borderStrong,
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>{suggestion}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View
        style={{
          flexDirection: 'row',
          gap: 10,
          paddingHorizontal: space.gutter,
          paddingTop: 10,
          paddingBottom: 14,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          alignItems: 'flex-end',
          backgroundColor: colors.glass,
        }}
      >
        <TextInput
          style={[shared.input, { flex: 1, maxHeight: 120, borderRadius: radius.lg }]}
          placeholder="Message your companion"
          placeholderTextColor={colors.textFaint}
          value={draft}
          onChangeText={setDraft}
          multiline
          editable={!sending}
          accessibilityLabel="Message"
        />
        <Pressable
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor:
              draft.trim() && !sending ? (colorMode ? accent : colors.text) : colors.surfaceHigh,
          }}
        >
          <Ionicons
            name="arrow-up"
            size={19}
            color={draft.trim() && !sending ? colors.background : colors.textFaint}
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function StatusPill({ online }: { online: boolean }) {
  return (
    <View
      accessibilityLabel={online ? 'Assistant connected' : 'Assistant not reachable'}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        alignSelf: 'flex-start',
      }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: online ? '#8FD6A8' : colors.textFaint,
        }}
      />
      <Text style={{ color: colors.textMuted, fontSize: 11.5 }}>
        {online ? 'Connected to your laptop' : 'Laptop offline'}
      </Text>
    </View>
  );
}

function Bubble({ message }: { message: AssistantMessageRow }) {
  const { accentSoft, colorMode } = useTheme();
  const mine = message.role === 'user';
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        borderRadius: radius.lg,
        borderBottomRightRadius: mine ? 6 : radius.lg,
        borderBottomLeftRadius: mine ? radius.lg : 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: mine
          ? colorMode
            ? accentSoft
            : 'rgba(255,255,255,0.1)'
          : colors.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: mine && colorMode ? 'rgba(168,140,242,0.35)' : colors.border,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
        {message.content ?? ''}
      </Text>
    </View>
  );
}
