import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View,
} from 'react-native';
import type { LibraryItemRow } from '@mypro/shared';
import { client } from '../lib/client';
import { colors, shared } from '../theme';

export interface BookSummary {
  id: string;
  title: string;
  creator: string;
  currentPage: number;
  totalPages: number;
  hasText: boolean;
}

function toBook(row: LibraryItemRow): BookSummary {
  const details = (row.book_details ?? {}) as Record<string, unknown>;
  const number = (value: unknown) => (typeof value === 'number' ? value : 0);
  return {
    id: row.id,
    title: row.title,
    creator: row.creator ?? '',
    currentPage: number(details.current_page) || 1,
    totalPages: number(details.total_pages),
    // Set by backend-render once a device has uploaded the extracted text.
    hasText: typeof details.pdf_json_path === 'string' && !!details.pdf_json_path,
  };
}

/** The books in your library, as the phone sees them. */
export function LibraryScreen({
  onOpen,
  onSignOut,
}: {
  onOpen: (book: BookSummary) => void;
  onSignOut: () => void;
}) {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await client.api.library.list({ type: 'book' });
      setBooks(rows.map(toBook));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your library.');
    } finally {
      setLoading(false);
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
    <View style={shared.screen}>
      <FlatList
        data={books}
        keyExtractor={(book) => book.id}
        contentContainerStyle={{ padding: 20, paddingTop: 64, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={colors.text} />
        }
        ListHeaderComponent={
          <View style={{ gap: 6, marginBottom: 12 }}>
            <Text style={shared.title}>Library</Text>
            {error ? (
              <Text style={{ color: '#ff9c8a', fontSize: 13 }}>{error}</Text>
            ) : (
              <Text style={shared.muted}>
                {books.length ? `${books.length} book${books.length === 1 ? '' : 's'}` : ''}
              </Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={shared.card}>
            <Text style={{ color: colors.text, fontSize: 15 }}>No books yet</Text>
            <Text style={shared.muted}>
              Add a PDF in the web app. Its text is extracted there and synced here — the
              file itself stays on that device.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={shared.card} onPress={() => onOpen(item)}>
            <Text style={{ color: colors.text, fontSize: 17 }}>{item.title}</Text>
            {!!item.creator && <Text style={shared.muted}>{item.creator}</Text>}
            <Text style={{ color: colors.textFaint, fontSize: 12 }}>
              {item.totalPages
                ? `Page ${item.currentPage} of ${item.totalPages}`
                : 'Not started'}
              {item.hasText ? '' : ' · text not extracted yet'}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={
          <Pressable
            style={[shared.ghostButton, { marginTop: 24 }]}
            onPress={async () => {
              await client.auth.signOut();
              onSignOut();
            }}
          >
            <Text style={shared.ghostLabel}>Sign out</Text>
          </Pressable>
        }
      />
    </View>
  );
}
