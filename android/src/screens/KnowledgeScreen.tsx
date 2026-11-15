import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { client } from '../lib/client';
import { colors, shared } from '../theme';

interface Note {
  id: string;
  kind: string;
  body: string;
  anchorText: string | null;
  chapter: string | null;
  page: number | null;
  createdAt: string | null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/**
 * Everything you marked while reading — Phase 8.3.
 *
 * My Knowledge is a view over `annotations`, not a table of its own, so this
 * reads the same `/knowledge` endpoint the web app does. No second source of
 * truth, and a highlight made on the phone shows up on the web unchanged.
 */
export function KnowledgeScreen() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { annotations } = await client.api.knowledge.get();
      setNotes(
        annotations.map((row) => ({
          id: String(row.id),
          kind: str(row.kind) ?? 'note',
          body: str(row.body) ?? str(row.title) ?? '',
          anchorText: str(row.anchor_text),
          chapter: str(row.chapter),
          page: typeof row.page === 'number' ? row.page : null,
          createdAt: str(row.created_at),
        })),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your notes.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <FlatList
      style={shared.screen}
      data={notes}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 20, paddingTop: 56, paddingBottom: 40, gap: 10 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.textMuted}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: 4, marginBottom: 14 }}>
          <Text style={shared.title}>My Knowledge</Text>
          <Text style={shared.muted}>
            {notes.length
              ? `${notes.length} highlight${notes.length === 1 ? '' : 's'} and note${notes.length === 1 ? '' : 's'}`
              : 'Everything you mark while reading collects here'}
          </Text>
          {error && (
            <Text style={{ color: colors.textMuted, fontSize: 12.5, marginTop: 8 }}>{error}</Text>
          )}
        </View>
      }
      ListEmptyComponent={
        !error ? (
          <View style={shared.card}>
            <Text style={shared.muted}>
              Nothing yet. Highlight a passage in the reader and it will appear here.
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={[shared.card, { gap: 6 }]}>
          <Text
            style={{
              color: colors.textFaint,
              fontSize: 10.5,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            {item.kind}
            {item.page ? ` · p.${item.page}` : ''}
            {item.chapter ? ` · ${item.chapter}` : ''}
          </Text>
          {item.anchorText && (
            <Text
              style={{
                color: colors.textStrong,
                fontSize: 14.5,
                lineHeight: 21,
                fontStyle: 'italic',
              }}
            >
              “{item.anchorText}”
            </Text>
          )}
          {item.body ? (
            <Text style={{ color: colors.text, fontSize: 14.5, lineHeight: 21 }}>{item.body}</Text>
          ) : null}
        </View>
      )}
    />
  );
}
