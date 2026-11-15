import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { chapterAt, type AnnotationRow } from '@mypro/shared';
import { client } from '../lib/client';
import { useBookText } from '../lib/useBookText';
import { anchorKey, useAnnotations } from '../lib/useAnnotations';
import { colors, shared } from '../theme';
import type { BookSummary } from './LibraryScreen';

/** A horizontal drag this far (and mostly sideways) turns the page. */
const SWIPE_DISTANCE = 60;
const SWIPE_SLOPE = 1.4;

/** What a long-press opens on. */
interface Selection {
  paragraph: number;
  text: string;
  existing: AnnotationRow[];
}

/**
 * The phone's reader (Phase 10.3, with touch interactions from Phase 8.5).
 *
 * It renders the extracted text that the device holding the PDF produced —
 * there is no PDF here to parse, which is exactly the point: the file stays
 * where it was imported.
 *
 * Touch, as it works here: swipe sideways to turn the page, long-press a
 * paragraph to highlight it or attach a note, tap a marked paragraph to see
 * what is on it. Annotations use the web app's anchoring model unchanged
 * (page + paragraph index + the passage), so a highlight made with a thumb
 * lands on the same sentence in the browser.
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const status = source?.status ?? 'loading';
  const pageCount = source?.pageCount || book.totalPages || 0;
  const marks = useAnnotations(book.id);

  const content = source?.page(page) ?? null;
  const chapter = useMemo(() => chapterAt(source?.toc ?? [], page), [source, page, status]);
  const bookmarked = marks.bookmarks.some((mark) => mark.page === page);

  /**
   * Page turning lives in a ref so the PanResponder — created once — always
   * sees the current page and bounds. Rebuilding the responder on every page
   * change would drop a gesture that is already in flight.
   */
  const turn = useRef<(delta: number) => void>(() => undefined);
  turn.current = (delta: number) => {
    setPage((current) => {
      const next = current + delta;
      if (next < 1) return current;
      if (pageCount && next > pageCount) return current;
      return next;
    });
  };

  const swipe = useMemo(
    () =>
      PanResponder.create({
        /* Claim the gesture only once it is clearly a sideways drag, so
         * vertical scrolling through a long page still belongs to the
         * ScrollView. */
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 18 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * SWIPE_SLOPE,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -SWIPE_DISTANCE) turn.current(1);
          else if (gesture.dx >= SWIPE_DISTANCE) turn.current(-1);
        },
      }),
    [],
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

  /**
   * Record the sitting when the reader closes.
   *
   * Written on unmount rather than on every page turn: one row per sitting is
   * what the reading-stats query wants, and `reading_sessions` is a table that
   * would otherwise grow by a row per flick of a thumb.
   */
  const openedAt = useRef(new Date().toISOString());
  const startPage = useRef(book.currentPage || 1);
  const lastPage = useRef(page);
  lastPage.current = page;
  useEffect(() => {
    const started = openedAt.current;
    const from = startPage.current;
    return () => {
      client.api.reader
        .readingSession(book.id, {
          started_at: started,
          ended_at: new Date().toISOString(),
          start_page: from,
          end_page: lastPage.current,
        })
        .catch(() => undefined);
    };
  }, [book.id]);

  const message = (): string => {
    if (status === 'error') return source?.error || 'This book could not be opened.';
    if (status === 'unavailable') {
      return 'No text for this book yet. Open it once in the web app, on the device that holds the PDF, and it will sync here.';
    }
    if (status === 'scanned') {
      return 'This PDF has no text layer — it looks scanned. Open it once in the web app and it will be read with text recognition, then sync here.';
    }
    if (status === 'loading') return 'Fetching the text…';
    if (content?.empty) return 'This page has no text.';
    return 'This page is not in the synced text.';
  };

  const openSelection = (paragraph: number, text: string) => {
    setSelection({
      paragraph,
      text,
      existing: marks.byAnchor.get(anchorKey(page, paragraph)) ?? [],
    });
  };

  const saveNote = async () => {
    if (!selection || noteDraft === null) return;
    const body = noteDraft.trim();
    if (body) {
      await marks.add({
        kind: 'note',
        page,
        paragraph: selection.paragraph,
        anchorText: selection.text,
        body,
        chapter: chapter?.title ?? null,
      });
    }
    setNoteDraft(null);
    setSelection(null);
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
          <Text style={{ color: colors.textFaint, fontSize: 13, flex: 1 }} numberOfLines={1}>
            {book.title}
          </Text>
          <Pressable onPress={() => void marks.toggleBookmark(page)} hitSlop={10}>
            <Text style={{ color: bookmarked ? colors.text : colors.textFaint, fontSize: 18 }}>
              {bookmarked ? '★' : '☆'}
            </Text>
          </Pressable>
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
        {...swipe.panHandlers}
      >
        {content?.paragraphs.length ? (
          content.paragraphs.map((paragraph, index) => {
            const annotations = marks.byAnchor.get(anchorKey(page, index)) ?? [];
            const highlighted = annotations.some((a) => a.kind === 'highlight');
            const noted = annotations.some((a) => a.kind !== 'highlight');
            return (
              <Pressable
                key={`${page}-${index}`}
                onLongPress={() => openSelection(index, paragraph)}
                onPress={() => {
                  if (annotations.length) openSelection(index, paragraph);
                }}
                delayLongPress={280}
              >
                <Text
                  style={{
                    color: colors.textStrong,
                    fontSize: 17,
                    lineHeight: 28,
                    /* A highlight is a translucent wash, never a solid fill:
                       the type is white, and a white background would make
                       the passage disappear — the mistake the web app's
                       monochrome tokens made three separate times. */
                    backgroundColor: highlighted ? 'rgba(255,255,255,0.12)' : 'transparent',
                  }}
                >
                  {paragraph}
                  {noted ? <Text style={{ color: colors.textFaint }}> ◦</Text> : null}
                </Text>
              </Pressable>
            );
          })
        ) : (
          <View style={shared.card}>
            <Text style={shared.muted}>{message()}</Text>
          </View>
        )}
        {!!content?.paragraphs.length && (
          <Text style={{ color: colors.textFaint, fontSize: 11.5, textAlign: 'center' }}>
            Swipe to turn · long-press a paragraph to mark it
          </Text>
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
          onPress={() => turn.current(-1)}
        >
          <Text style={shared.ghostLabel}>Previous</Text>
        </Pressable>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>
          {pageCount ? `${page} / ${pageCount}` : page}
        </Text>
        <Pressable
          style={[shared.ghostButton, !!pageCount && page >= pageCount && { opacity: 0.4 }]}
          disabled={!!pageCount && page >= pageCount}
          onPress={() => turn.current(1)}
        >
          <Text style={shared.ghostLabel}>Next</Text>
        </Pressable>
      </View>

      <Modal
        visible={!!selection}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setSelection(null);
          setNoteDraft(null);
        }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}
          onPress={() => {
            setSelection(null);
            setNoteDraft(null);
          }}
        >
          {/* Stop the backdrop's press from closing the sheet itself. */}
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: colors.surface,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              paddingBottom: 34,
              gap: 14,
            }}
          >
            <Text
              style={{ color: colors.textMuted, fontSize: 13.5, lineHeight: 20 }}
              numberOfLines={3}
            >
              “{selection?.text}”
            </Text>

            {noteDraft === null ? (
              <>
                {selection?.existing.map((annotation) => (
                  <View
                    key={annotation.id}
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      paddingTop: 12,
                      gap: 6,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.textFaint,
                        fontSize: 10.5,
                        letterSpacing: 1.2,
                        textTransform: 'uppercase',
                      }}
                    >
                      {annotation.kind}
                    </Text>
                    {!!annotation.body && (
                      <Text style={{ color: colors.text, fontSize: 14.5, lineHeight: 21 }}>
                        {annotation.body}
                      </Text>
                    )}
                    <Pressable onPress={() => void marks.remove(annotation.id)} hitSlop={8}>
                      <Text style={{ color: colors.textMuted, fontSize: 13 }}>Remove</Text>
                    </Pressable>
                  </View>
                ))}

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    style={[shared.ghostButton, { flex: 1 }]}
                    onPress={async () => {
                      if (!selection) return;
                      const highlight = selection.existing.find((a) => a.kind === 'highlight');
                      if (highlight) await marks.remove(highlight.id);
                      else
                        await marks.add({
                          kind: 'highlight',
                          page,
                          paragraph: selection.paragraph,
                          anchorText: selection.text,
                          chapter: chapter?.title ?? null,
                        });
                      setSelection(null);
                    }}
                  >
                    <Text style={shared.ghostLabel}>
                      {selection?.existing.some((a) => a.kind === 'highlight')
                        ? 'Unhighlight'
                        : 'Highlight'}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[shared.ghostButton, { flex: 1 }]}
                    onPress={() => setNoteDraft('')}
                  >
                    <Text style={shared.ghostLabel}>Add note</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <TextInput
                  style={[shared.input, { minHeight: 90, textAlignVertical: 'top' }]}
                  placeholder="What did this make you think?"
                  placeholderTextColor={colors.textFaint}
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  multiline
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    style={[shared.ghostButton, { flex: 1 }]}
                    onPress={() => setNoteDraft(null)}
                  >
                    <Text style={shared.ghostLabel}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[shared.button, { flex: 1 }]}
                    onPress={() => void saveNote()}
                  >
                    <Text style={shared.buttonLabel}>Save note</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
