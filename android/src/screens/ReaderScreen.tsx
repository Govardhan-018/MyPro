import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { chapterAt } from '@mypro/shared';
import { client } from '../lib/client';
import { useBookText } from '../lib/useBookText';
import { colors, shared } from '../theme';
import type { BookSummary } from './LibraryScreen';

/**
 * The phone's reader (Roadmap Phase 10.3). It renders the extracted text that
 * the device holding the PDF produced — there is no PDF here to parse, which
 * is exactly the point: the file stays where it was imported.
 */
export function ReaderScreen({
  book,
  onClose,
}: {
  book: BookSummary;
  onClose: () => void;
}) {
  const { source } = useBookText(book.id);
  const [page, setPage] = useState(book.currentPage || 1);
  const scrollRef = useRef<ScrollView>(null);
  const status = source?.status ?? 'loading';
  const pageCount = source?.pageCount || book.totalPages || 0;

  const content = source?.page(page) ?? null;
  const chapter = useMemo(
    () => chapterAt(source?.toc ?? [], page),
    [source, page, status],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [page]);

  // Remember where you stopped, so the web app and the phone agree.
  useEffect(() => {
    if (!pageCount) return;
    const timer = setTimeout(() => {
      client.api.library
        .update(book.id, {
          progress: Math.min(100, Math.round((page / pageCount) * 100)),
          details: { current_page: page, total_pages: pageCount },
        })
        .catch(() => undefined);
    }, 1200);
    return () => clearTimeout(timer);
  }, [book.id, page, pageCount]);

  const message = (): string => {
    if (status === 'error') return source?.error || 'This book could not be opened.';
    if (status === 'unavailable') {
      return 'No text for this book yet. Open it once in the web app, on the device that holds the PDF, and it will sync here.';
    }
    if (status === 'scanned') {
      return 'This PDF has no text layer — it looks scanned. Text recognition is coming in a later release.';
    }
    if (status === 'loading') return 'Fetching the text…';
    if (content?.empty) return 'This page has no text.';
    return 'This page is not in the synced text.';
  };

  return (
    <View style={shared.screen}>
      <View
        style={{
          paddingTop: 56,
          paddingHorizontal: 20,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: 4,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={{ color: colors.textStrong, fontSize: 15 }}>‹ Library</Text>
          </Pressable>
          <Text style={{ color: colors.textFaint, fontSize: 13 }} numberOfLines={1}>
            {book.title}
          </Text>
        </View>
        {!!chapter && (
          <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>
            {chapter.part ? `${chapter.part} · ` : ''}
            {chapter.title}
          </Text>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: 22, paddingBottom: 48, gap: 18 }}
      >
        {content?.paragraphs.length ? (
          content.paragraphs.map((paragraph, index) => (
            <Text
              key={`${page}-${index}`}
              style={{ color: colors.textStrong, fontSize: 17, lineHeight: 28 }}
            >
              {paragraph}
            </Text>
          ))
        ) : (
          <View style={shared.card}>
            <Text style={shared.muted}>{message()}</Text>
          </View>
        )}
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingVertical: 14,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Pressable
          style={[shared.ghostButton, page <= 1 && { opacity: 0.4 }]}
          disabled={page <= 1}
          onPress={() => setPage((p) => Math.max(1, p - 1))}
        >
          <Text style={shared.ghostLabel}>Previous</Text>
        </Pressable>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>
          {pageCount ? `${page} / ${pageCount}` : page}
        </Text>
        <Pressable
          style={[shared.ghostButton, !!pageCount && page >= pageCount && { opacity: 0.4 }]}
          disabled={!!pageCount && page >= pageCount}
          onPress={() => setPage((p) => (pageCount ? Math.min(pageCount, p + 1) : p + 1))}
        >
          <Text style={shared.ghostLabel}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}
