/**
 * Library — your personal knowledge collection, as the phone sees it.
 *
 * Search, reading-status filters, and proper book cards with placeholder
 * covers and progress. The phone still only syncs books: adding new items
 * (and the PDFs themselves) lives on the device that holds the files.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LibraryItemRow } from '@mypro/shared';
import { client } from '../lib/client';
import {
  Card, Chip, EmptyState, FadeIn, PlaceholderCover, ProgressBar,
} from '../components/ui';
import { colors, shared, space, type } from '../theme';

export interface BookSummary {
  id: string;
  title: string;
  creator: string;
  currentPage: number;
  totalPages: number;
  hasText: boolean;
}

interface Shelf extends BookSummary {
  status: string;
  progress: number;
}

function toShelf(row: LibraryItemRow): Shelf {
  const details = (row.book_details ?? {}) as Record<string, unknown>;
  const number = (value: unknown) => (typeof value === 'number' ? value : 0);
  const totalPages = number(details.total_pages);
  const currentPage = number(details.current_page) || 1;
  return {
    id: row.id,
    title: row.title,
    creator: row.creator ?? '',
    currentPage,
    totalPages,
    // Set by backend-render once a device has uploaded the extracted text.
    hasText: typeof details.pdf_json_path === 'string' && !!details.pdf_json_path,
    status: typeof row.status === 'string' ? row.status : 'want_to_read',
    progress:
      typeof row.progress === 'number'
        ? row.progress
        : totalPages
          ? Math.round((currentPage / totalPages) * 100)
          : 0,
  };
}

type Filter = 'all' | 'in_progress' | 'completed' | 'want_to_read';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'in_progress', label: 'Reading' },
  { key: 'want_to_read', label: 'Want to read' },
  { key: 'completed', label: 'Finished' },
];

export function LibraryScreen({ onOpen }: { onOpen: (book: BookSummary) => void }) {
  const [books, setBooks] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await client.api.library.list({ type: 'book' });
      setBooks(rows.map(toShelf));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return books.filter((book) => {
      if (filter !== 'all' && book.status !== filter) return false;
      if (!needle) return true;
      return (
        book.title.toLowerCase().includes(needle) ||
        book.creator.toLowerCase().includes(needle)
      );
    });
  }, [books, query, filter]);

  if (loading) {
    return (
      <View style={[shared.screen, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <View style={shared.screen}>
      <FlatList
        data={visible}
        keyExtractor={(book) => book.id}
        contentContainerStyle={{
          padding: space.gutter,
          paddingTop: 8,
          paddingBottom: 48,
          gap: 10,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={colors.text} />
        }
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 8 }}>
            <FadeIn index={0} style={{ gap: 4 }}>
              <Text style={type.title}>Library</Text>
              {error ? (
                <Text style={{ color: colors.danger, fontSize: 13 }}>{error}</Text>
              ) : (
                <Text style={type.support}>
                  {books.length
                    ? `${books.length} book${books.length === 1 ? '' : 's'} in your collection`
                    : 'Your personal collection'}
                </Text>
              )}
            </FadeIn>

            <FadeIn index={1} style={{ gap: 10 }}>
              {/* Search */}
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
                  placeholder="Search your books"
                  placeholderTextColor={colors.textFaint}
                  value={query}
                  onChangeText={setQuery}
                  returnKeyType="search"
                  accessibilityLabel="Search your books"
                />
                {query.length > 0 && (
                  <Ionicons
                    name="close-circle"
                    size={16}
                    color={colors.textFaint}
                    onPress={() => setQuery('')}
                  />
                )}
              </View>

              {/* Status filters */}
              <FlatList
                horizontal
                data={FILTERS}
                keyExtractor={(f) => f.key}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
                renderItem={({ item }) => (
                  <Chip
                    label={item.label}
                    active={filter === item.key}
                    onPress={() => setFilter(item.key)}
                  />
                )}
              />
            </FadeIn>
          </View>
        }
        ListEmptyComponent={
          !error ? (
            books.length ? (
              <EmptyState
                icon="search-outline"
                title="No matches"
                body="Nothing in your library fits that search and filter."
              />
            ) : (
              <EmptyState
                icon="book-outline"
                title="No books yet"
                body="Add a PDF in the web app. Its text is extracted there and synced here — the file itself stays on that device."
              />
            )
          ) : null
        }
        renderItem={({ item, index }) => {
          const fraction = item.totalPages
            ? item.currentPage / item.totalPages
            : item.progress / 100;
          return (
            <FadeIn index={Math.min(index + 2, 8)}>
              <Card
                onPress={() => onOpen(item)}
                accessibilityLabel={`Open ${item.title}`}
                style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}
              >
                <PlaceholderCover title={item.title} width={56} height={80} />
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={type.cardTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {!!item.creator && (
                    <Text style={type.support} numberOfLines={1}>
                      {item.creator}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {item.status === 'completed' ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <Ionicons name="checkmark-circle" size={13} color={colors.textMuted} />
                        <Text style={type.label}>Finished</Text>
                      </View>
                    ) : item.totalPages ? (
                      <>
                        <ProgressBar value={fraction} style={{ flex: 1, maxWidth: 140 }} />
                        <Text style={type.label}>
                          p. {item.currentPage} / {item.totalPages}
                        </Text>
                      </>
                    ) : (
                      <Text style={type.label}>Not started</Text>
                    )}
                  </View>
                  {!item.hasText && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      <Ionicons name="cloud-offline-outline" size={12} color={colors.textFaint} />
                      <Text style={type.label}>Text not synced yet</Text>
                    </View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
              </Card>
            </FadeIn>
          );
        }}
      />
    </View>
  );
}
