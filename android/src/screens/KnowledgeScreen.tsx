/**
 * My Knowledge — the web app's knowledge view, as a phone screen.
 *
 * Same heading and same promise as `KnowledgeView` in
 * `frontend/src/App.tsx`. It reads the same `/knowledge` endpoint, which is a
 * view over `annotations` rather than a table of its own — no second source
 * of truth, so a highlight made on the phone shows up in the browser
 * unchanged.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl, ScrollView, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { client } from '../lib/client';
import {
  Card, ChipRow, DataBanner, EmptyState, FadeIn, FilterChip, Loading, PageHeading,
} from '../components/ui';
import { colors, radius, shared, space, type } from '../theme';

interface Note {
  id: string;
  kind: string;
  body: string;
  anchorText: string | null;
  chapter: string | null;
  page: number | null;
  createdAt: string | null;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

type KindFilter = 'All' | 'Highlights' | 'Notes' | 'Quotes' | 'Questions';

const FILTERS: KindFilter[] = ['All', 'Highlights', 'Notes', 'Quotes', 'Questions'];

/** The annotation kinds each filter accepts. */
const FILTER_KINDS: Record<Exclude<KindFilter, 'All'>, string[]> = {
  Highlights: ['highlight'],
  Notes: ['note'],
  Quotes: ['quote'],
  Questions: ['question'],
};

export function KnowledgeScreen() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KindFilter>('All');

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
      if (filter !== 'All' && !FILTER_KINDS[filter].includes(note.kind)) return false;
      if (!needle) return true;
      return (
        note.body.toLowerCase().includes(needle) ||
        (note.anchorText ?? '').toLowerCase().includes(needle) ||
        (note.chapter ?? '').toLowerCase().includes(needle)
      );
    });
  }, [notes, query, filter]);

  if (loading) return <Loading />;

  return (
    <View style={shared.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 22,
          paddingBottom: 28,
        }}
        keyboardShouldPersistTaps="handled"
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
      >
        <PageHeading
          eyebrow="My knowledge"
          title="Everything you saved, connected."
          lede="Notes, highlights, quotes, summaries, and questions — organized across your library."
        />

        {!!error && <DataBanner message={error} error />}

        {notes.length > 0 && (
          <FadeIn index={1} style={{ marginBottom: space.md }}>
            <View
              style={{
                height: 50,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: space.md,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                borderRadius: radius.lg,
                backgroundColor: colors.surface,
              }}
            >
              <Ionicons name="search" size={17} color={colors.textSoft} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 }}
                placeholder="Search your knowledge"
                placeholderTextColor="rgba(255,255,255,0.44)"
                value={query}
                onChangeText={setQuery}
                accessibilityLabel="Search your knowledge"
              />
            </View>

            <View style={{ marginTop: 10 }}>
              <ChipRow>
                {FILTERS.map((option) => (
                  <FilterChip
                    key={option}
                    label={option}
                    active={filter === option}
                    onPress={() => setFilter(option)}
                  />
                ))}
              </ChipRow>
            </View>
          </FadeIn>
        )}

        {visible.length === 0 ? (
          <FadeIn index={2}>
            <Card>
              <EmptyState
                icon="bulb-outline"
                title={notes.length ? 'No matches' : 'Nothing saved yet'}
                body={
                  notes.length
                    ? 'Nothing fits that search and filter.'
                    : 'Highlight a passage in the reader and it will appear here.'
                }
              />
            </Card>
          </FadeIn>
        ) : (
          <View style={{ gap: 10 }}>
            {visible.map((note, index) => (
              <FadeIn key={note.id} index={Math.min(index + 2, 8)}>
                <Card style={{ gap: 8 }}>
                  <Text style={type.label}>
                    {note.kind}
                    {note.page ? ` · p.${note.page}` : ''}
                    {note.chapter ? ` · ${note.chapter}` : ''}
                  </Text>
                  {!!note.anchorText && (
                    <Text
                      style={{
                        color: colors.textStrong,
                        fontSize: 14.5,
                        lineHeight: 21,
                        fontStyle: 'italic',
                      }}
                    >
                      “{note.anchorText}”
                    </Text>
                  )}
                  {!!note.body && (
                    <Text style={{ color: colors.text, fontSize: 14.5, lineHeight: 21 }}>
                      {note.body}
                    </Text>
                  )}
                </Card>
              </FadeIn>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
