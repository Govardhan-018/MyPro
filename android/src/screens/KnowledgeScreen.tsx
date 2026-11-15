/**
 * My Knowledge — everything you marked while reading. MYPRO 2.0.
 *
 * A view over `annotations`, not a table of its own, so this reads the same
 * `/knowledge` endpoint the web app does. No second source of truth, and a
 * highlight made on the phone shows up on the web unchanged. The phone adds
 * search and kind filters so a half-remembered quote is findable.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import { Card, Chip, EmptyState, FadeIn } from '../components/ui';
import { colors, shared, space, type } from '../theme';

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

type KindFilter = 'all' | 'highlight' | 'note' | 'other';

export function KnowledgeScreen({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notes.filter((note) => {
      if (kind === 'highlight' && note.kind !== 'highlight') return false;
      if (kind === 'note' && note.kind !== 'note') return false;
      if (kind === 'other' && (note.kind === 'highlight' || note.kind === 'note')) return false;
      if (!needle) return true;
      return (
        note.body.toLowerCase().includes(needle) ||
        (note.anchorText ?? '').toLowerCase().includes(needle) ||
        (note.chapter ?? '').toLowerCase().includes(needle)
      );
    });
  }, [notes, query, kind]);

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
      data={visible}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: space.gutter,
        paddingTop: 56,
        paddingBottom: 48,
        gap: 10,
      }}
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
        <View style={{ gap: 14, marginBottom: 6 }}>
          <FadeIn index={0}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.surface,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                }}
              >
                <Ionicons name="chevron-back" size={19} color={colors.text} />
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.title}>My Knowledge</Text>
                <Text style={type.support}>
                  {notes.length
                    ? `${notes.length} mark${notes.length === 1 ? '' : 's'} from your reading`
                    : 'Everything you mark while reading collects here'}
                </Text>
              </View>
            </View>
            {error && (
              <Text style={{ color: colors.danger, fontSize: 12.5, marginTop: 8 }}>{error}</Text>
            )}
          </FadeIn>

          {notes.length > 0 && (
            <FadeIn index={1} style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                }}
              >
                <Ionicons name="search" size={16} color={colors.textFaint} />
                <TextInput
                  style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 }}
                  placeholder="Search your highlights and notes"
                  placeholderTextColor={colors.textFaint}
                  value={query}
                  onChangeText={setQuery}
                  accessibilityLabel="Search your knowledge"
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'highlight', label: 'Highlights' },
                    { key: 'note', label: 'Notes' },
                    { key: 'other', label: 'More' },
                  ] as { key: KindFilter; label: string }[]
                ).map((option) => (
                  <Chip
                    key={option.key}
                    label={option.label}
                    active={kind === option.key}
                    onPress={() => setKind(option.key)}
                  />
                ))}
              </View>
            </FadeIn>
          )}
        </View>
      }
      ListEmptyComponent={
        !error ? (
          notes.length ? (
            <EmptyState icon="search-outline" title="No matches" body="Nothing fits that search." />
          ) : (
            <EmptyState
              icon="library-outline"
              title="Nothing yet"
              body="Highlight a passage in the reader and it will appear here."
            />
          )
        ) : null
      }
      renderItem={({ item, index }) => (
        <FadeIn index={Math.min(index + 2, 8)}>
          <Card style={{ gap: 7 }}>
            <Text style={type.eyebrow}>
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
            {item.body ? <Text style={type.body}>{item.body}</Text> : null}
          </Card>
        </FadeIn>
      )}
    />
  );
}
