import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View,
} from 'react-native';
import { AgentOfflineError, type AssistantMessageRow } from '@mypro/shared';
import { client } from '../lib/client';
import { colors, shared } from '../theme';

/**
 * The assistant, on the phone — Phase 8.3.
 *
 * All assistant traffic goes straight to the laptop, not through render: it is
 * the only machine holding the model key. So this screen has a state the other
 * screens do not — the agent being asleep — and it says so plainly instead of
 * showing a text box that swallows what you type.
 */
export function AssistantScreen() {
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

  const send = async () => {
    const content = draft.trim();
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
      <View style={[shared.screen, { padding: 20, paddingTop: 56, gap: 18 }]}>
        <Text style={shared.title}>Companion</Text>
        <View style={shared.card}>
          <Text style={{ color: colors.text, fontSize: 15 }}>Your laptop is asleep</Text>
          <Text style={shared.muted}>
            The assistant runs at home, on the only machine that holds the model key.
            Everything else in MyPro keeps working — open the laptop and the
            conversation picks up where it left off.
          </Text>
          <Pressable style={[shared.ghostButton, { marginTop: 6 }]} onPress={() => void load()}>
            <Text style={shared.ghostLabel}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={shared.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 56, paddingBottom: 12 }}>
        <Text style={shared.title}>Companion</Text>
      </View>

      {error && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
          <Text style={{ color: colors.textMuted, fontSize: 12.5 }}>{error}</Text>
        </View>
      )}

      <FlatList
        ref={listRef}
        data={messages}
        /* Inverted so new messages appear at the bottom without measuring. */
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}
        ListEmptyComponent={
          <Text style={[shared.muted, { textAlign: 'center', marginTop: 40 }]}>
            Say anything — it remembers.
          </Text>
        }
        renderItem={({ item }) => <Bubble message={item} />}
      />

      <View
        style={{
          flexDirection: 'row',
          gap: 10,
          padding: 16,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          alignItems: 'flex-end',
        }}
      >
        <TextInput
          style={[shared.input, { flex: 1, maxHeight: 120 }]}
          placeholder="Message"
          placeholderTextColor={colors.textFaint}
          value={draft}
          onChangeText={setDraft}
          multiline
          editable={!sending}
        />
        <Pressable
          style={[
            shared.button,
            { paddingHorizontal: 20, opacity: draft.trim() && !sending ? 1 : 0.4 },
          ]}
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
        >
          <Text style={shared.buttonLabel}>{sending ? '…' : 'Send'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Bubble({ message }: { message: AssistantMessageRow }) {
  const mine = message.role === 'user';
  return (
    <View
      style={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: mine ? 'rgba(255,255,255,0.1)' : colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>{message.content ?? ""}</Text>
    </View>
  );
}
