/**
 * The reader — MYPRO 2.0's first-class reading environment on the phone.
 *
 * It renders the extracted text that the device holding the PDF produced —
 * there is no PDF file here to rasterise, which is the architecture, not an
 * omission: the file stays on the device that imported it. What this screen
 * owns is making that text read beautifully:
 *
 *  - four reading themes (dark / dim / sepia / light), per-device
 *  - adjustable type size and line spacing, persisted
 *  - immersive mode: chrome fades away; tap the page to bring it back
 *  - a glass footer with page slider, position and percentage
 *  - contents, bookmarks/highlights and notes, each one tap from the header,
 *    every entry jumping back to its page
 *  - the same long-press annotation model as the web, unchanged anchors
 *
 * Reading position still syncs through Render, so the web app agrees.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, PanResponder, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { chapterAt, type AnnotationRow, type PdfTocEntry } from '@mypro/shared';
import { client } from '../lib/client';
import { useBookText } from '../lib/useBookText';
import { anchorKey, useAnnotations } from '../lib/useAnnotations';
import { GhostButton, PrimaryButton, Sheet, type IconName } from '../components/ui';
import { colors, radius, shared, space, type } from '../theme';
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

/* ------------------------------------------------------------------------ */
/* Reading appearance                                                        */
/* ------------------------------------------------------------------------ */

type ReaderThemeName = 'dark' | 'dim' | 'sepia' | 'light';

interface ReaderTheme {
  name: ReaderThemeName;
  label: string;
  bg: string;
  text: string;
  muted: string;
  faint: string;
  chrome: string;
  chromeBorder: string;
  /** The highlight wash — must stay translucent so the type survives it. */
  mark: string;
}

const THEMES: Record<ReaderThemeName, ReaderTheme> = {
  dark: {
    name: 'dark',
    label: 'Dark',
    bg: '#050607',
    text: '#E9E9EC',
    muted: '#A0A4AD',
    faint: '#737983',
    chrome: 'rgba(17,19,23,0.96)',
    chromeBorder: 'rgba(255,255,255,0.12)',
    mark: 'rgba(168,140,242,0.22)',
  },
  dim: {
    name: 'dim',
    label: 'Dim',
    bg: '#14161B',
    text: '#D6D8DE',
    muted: '#9BA0AA',
    faint: '#6F7580',
    chrome: 'rgba(23,26,32,0.96)',
    chromeBorder: 'rgba(255,255,255,0.1)',
    mark: 'rgba(168,140,242,0.22)',
  },
  sepia: {
    name: 'sepia',
    label: 'Sepia',
    bg: '#F2E9D8',
    text: '#3B3226',
    muted: '#6E6353',
    faint: '#998D7A',
    chrome: 'rgba(238,227,207,0.97)',
    chromeBorder: 'rgba(59,50,38,0.14)',
    mark: 'rgba(188,140,80,0.26)',
  },
  light: {
    name: 'light',
    label: 'Light',
    bg: '#FAFAF8',
    text: '#1C1C1E',
    muted: '#5B5B60',
    faint: '#8E8E93',
    chrome: 'rgba(250,250,248,0.97)',
    chromeBorder: 'rgba(0,0,0,0.12)',
    mark: 'rgba(255,205,80,0.4)',
  },
};

interface ReaderPrefs {
  theme: ReaderThemeName;
  fontSize: number;
  lineHeight: number; // multiplier
}

const PREFS_KEY = 'mypro.readerPrefs';
const DEFAULT_PREFS: ReaderPrefs = { theme: 'dark', fontSize: 17, lineHeight: 1.65 };

function useReaderPrefs(): [ReaderPrefs, (patch: Partial<ReaderPrefs>) => void] {
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
        setPrefs({
          theme: parsed.theme && parsed.theme in THEMES ? parsed.theme : DEFAULT_PREFS.theme,
          fontSize:
            typeof parsed.fontSize === 'number'
              ? Math.min(22, Math.max(14, parsed.fontSize))
              : DEFAULT_PREFS.fontSize,
          lineHeight:
            typeof parsed.lineHeight === 'number'
              ? Math.min(2, Math.max(1.4, parsed.lineHeight))
              : DEFAULT_PREFS.lineHeight,
        });
      })
      .catch(() => undefined);
  }, []);

  const update = (patch: Partial<ReaderPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  };

  return [prefs, update];
}

/* ------------------------------------------------------------------------ */
/* The screen                                                                */
/* ------------------------------------------------------------------------ */

type NavTab = 'contents' | 'marks' | 'notes';

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
  const [prefs, updatePrefs] = useReaderPrefs();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [navSheet, setNavSheet] = useState<NavTab | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const status = source?.status ?? 'loading';
  const pageCount = source?.pageCount || book.totalPages || 0;
  const marks = useAnnotations(book.id);
  const theme = THEMES[prefs.theme];

  const content = source?.page(page) ?? null;
  const chapter = useMemo(() => chapterAt(source?.toc ?? [], page), [source, page, status]);
  const bookmarked = marks.bookmarks.some((mark) => mark.page === page);
  const percent = pageCount ? Math.min(100, Math.round((page / pageCount) * 100)) : 0;

  /* Chrome fade ----------------------------------------------------------- */
  const chrome = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(chrome, {
      toValue: chromeVisible ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [chromeVisible, chrome]);

  /* Page turning ----------------------------------------------------------- */
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
         * ScrollView — and so taps still reach the paragraphs. */
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

  /* Progress sync ----------------------------------------------------------- */
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

  /* Helpers ----------------------------------------------------------------- */
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

  const jumpTo = (target: number) => {
    setNavSheet(null);
    if (target >= 1 && (!pageCount || target <= pageCount)) setPage(target);
  };

  /* Annotation lists for the sheets ----------------------------------------- */
  const allAnnotations = useMemo(() => {
    const rows: AnnotationRow[] = [];
    for (const bucket of marks.byAnchor.values()) rows.push(...bucket);
    return rows.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
  }, [marks.byAnchor]);
  const highlightRows = allAnnotations.filter((row) => row.kind === 'highlight');
  const noteRows = allAnnotations.filter((row) => row.kind !== 'highlight');

  /* ------------------------------------------------------------------------ */

  return (
    <View style={[shared.screen, { backgroundColor: theme.bg }]}>
      {/* Top toolbar — dissolves in immersive mode. */}
      <Animated.View
        pointerEvents={chromeVisible ? 'auto' : 'none'}
        style={{
          opacity: chrome,
          transform: [
            { translateY: chrome.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
          ],
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          backgroundColor: theme.chrome,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.chromeBorder,
          paddingTop: 50,
          paddingBottom: 10,
          paddingHorizontal: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <ToolbarButton icon="chevron-back" label="Back to library" theme={theme} onPress={onClose} />
          <View style={{ flex: 1, gap: 1, paddingHorizontal: 6 }}>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
              {book.title}
            </Text>
            {!!chapter && (
              <Text style={{ color: theme.faint, fontSize: 11.5 }} numberOfLines={1}>
                {chapter.part ? `${chapter.part} · ` : ''}
                {chapter.title}
              </Text>
            )}
          </View>
          <ToolbarButton
            icon={bookmarked ? 'bookmark' : 'bookmark-outline'}
            label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            theme={theme}
            onPress={() => void marks.toggleBookmark(page)}
          />
          <ToolbarButton
            icon="text"
            label="Reading appearance"
            theme={theme}
            onPress={() => setAppearanceOpen(true)}
          />
          <ToolbarButton
            icon="list-outline"
            label="Contents and notes"
            theme={theme}
            onPress={() => setNavSheet('contents')}
          />
        </View>
      </Animated.View>

      {/* The page */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{
          paddingTop: 116,
          paddingBottom: 140,
          paddingHorizontal: 24,
          gap: Math.round(prefs.fontSize * 1.05),
        }}
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
                  /* A marked paragraph opens its marks; anywhere else, a tap
                   * toggles immersive chrome — the Apple Books gesture. */
                  if (annotations.length) openSelection(index, paragraph);
                  else setChromeVisible((visible) => !visible);
                }}
                delayLongPress={280}
              >
                <Text
                  style={{
                    color: theme.text,
                    fontSize: prefs.fontSize,
                    lineHeight: Math.round(prefs.fontSize * prefs.lineHeight),
                    /* A highlight is a translucent wash, never a solid fill:
                       a solid background would erase the type. */
                    backgroundColor: highlighted ? theme.mark : 'transparent',
                  }}
                >
                  {paragraph}
                  {noted ? <Text style={{ color: theme.faint }}> ◦</Text> : null}
                </Text>
              </Pressable>
            );
          })
        ) : (
          <Pressable
            onPress={() => setChromeVisible((visible) => !visible)}
            style={{
              borderRadius: radius.lg,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.chromeBorder,
              padding: space.lg,
              marginTop: 40,
            }}
          >
            <Text style={{ color: theme.muted, fontSize: 14.5, lineHeight: 21 }}>
              {message()}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Floating glass reading controls */}
      <Animated.View
        pointerEvents={chromeVisible ? 'auto' : 'none'}
        style={{
          opacity: chrome,
          transform: [
            { translateY: chrome.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: 24,
          zIndex: 10,
          borderRadius: radius.xl,
          backgroundColor: theme.chrome,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.chromeBorder,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 14,
          gap: 10,
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        {pageCount > 1 && (
          <PageSlider
            page={page}
            pageCount={pageCount}
            theme={theme}
            onSeek={(target) => jumpTo(target)}
          />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ToolbarButton
            icon="chevron-back"
            label="Previous page"
            theme={theme}
            disabled={page <= 1}
            onPress={() => turn.current(-1)}
          />
          <Text
            style={{
              flex: 1,
              textAlign: 'center',
              color: theme.muted,
              fontSize: 12.5,
              fontVariant: ['tabular-nums'],
            }}
          >
            {pageCount ? `Page ${page} of ${pageCount} · ${percent}%` : `Page ${page}`}
          </Text>
          <ToolbarButton
            icon="chevron-forward"
            label="Next page"
            theme={theme}
            disabled={!!pageCount && page >= pageCount}
            onPress={() => turn.current(1)}
          />
        </View>
      </Animated.View>

      {/* Appearance sheet */}
      <Sheet visible={appearanceOpen} onClose={() => setAppearanceOpen(false)} title="Reading appearance">
        <View style={{ gap: 18 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {(Object.values(THEMES) as ReaderTheme[]).map((option) => (
              <Pressable
                key={option.name}
                onPress={() => updatePrefs({ theme: option.name })}
                accessibilityRole="button"
                accessibilityLabel={`${option.label} theme`}
                accessibilityState={{ selected: prefs.theme === option.name }}
                style={{ flex: 1, alignItems: 'center', gap: 6 }}
              >
                <View
                  style={{
                    width: '100%',
                    height: 56,
                    borderRadius: radius.md,
                    backgroundColor: option.bg,
                    borderWidth: prefs.theme === option.name ? 2 : StyleSheet.hairlineWidth,
                    borderColor:
                      prefs.theme === option.name ? colors.violet : colors.borderStrong,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: option.text, fontSize: 17 }}>Aa</Text>
                </View>
                <Text style={type.label}>{option.label}</Text>
              </Pressable>
            ))}
          </View>

          <Stepper
            label="Text size"
            value={`${prefs.fontSize}`}
            onLess={() => updatePrefs({ fontSize: Math.max(14, prefs.fontSize - 1) })}
            onMore={() => updatePrefs({ fontSize: Math.min(22, prefs.fontSize + 1) })}
          />
          <Stepper
            label="Line spacing"
            value={prefs.lineHeight.toFixed(2)}
            onLess={() => updatePrefs({ lineHeight: Math.max(1.4, +(prefs.lineHeight - 0.1).toFixed(2)) })}
            onMore={() => updatePrefs({ lineHeight: Math.min(2, +(prefs.lineHeight + 0.1).toFixed(2)) })}
          />
        </View>
      </Sheet>

      {/* Contents / marks / notes sheet */}
      <Sheet visible={navSheet !== null} onClose={() => setNavSheet(null)}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: space.md }}>
          {(
            [
              { key: 'contents', label: 'Contents' },
              { key: 'marks', label: 'Marks' },
              { key: 'notes', label: 'Notes' },
            ] as { key: NavTab; label: string }[]
          ).map((tabOption) => (
            <Pressable
              key={tabOption.key}
              onPress={() => setNavSheet(tabOption.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: navSheet === tabOption.key }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: 9,
                borderRadius: radius.md,
                backgroundColor: navSheet === tabOption.key ? colors.surfaceHigh : 'transparent',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: navSheet === tabOption.key ? colors.borderStrong : 'transparent',
              }}
            >
              <Text
                style={{
                  color: navSheet === tabOption.key ? colors.text : colors.textFaint,
                  fontSize: 13.5,
                  fontWeight: navSheet === tabOption.key ? '600' : '400',
                }}
              >
                {tabOption.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 4, paddingBottom: 8 }}>
          {navSheet === 'contents' &&
            ((source?.toc?.length ?? 0) > 0 ? (
              (source?.toc ?? []).map((entry: PdfTocEntry) => (
                <Pressable
                  key={entry.id}
                  onPress={() => jumpTo(entry.page)}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to ${entry.title}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingVertical: 11,
                    paddingHorizontal: 10,
                    borderRadius: radius.sm,
                    backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
                  })}
                >
                  <View style={{ flex: 1, gap: 1 }}>
                    {!!entry.part && <Text style={type.label}>{entry.part}</Text>}
                    <Text
                      style={{
                        color:
                          chapter && chapter.id === entry.id ? colors.text : colors.textStrong,
                        fontSize: 14.5,
                        fontWeight: chapter && chapter.id === entry.id ? '700' : '400',
                      }}
                      numberOfLines={2}
                    >
                      {entry.title}
                    </Text>
                  </View>
                  <Text style={type.label}>{entry.page}</Text>
                </Pressable>
              ))
            ) : (
              <Text style={[type.support, { padding: 10 }]}>
                This book has no table of contents in its synced text.
              </Text>
            ))}

          {navSheet === 'marks' && (
            <>
              {marks.bookmarks.length === 0 && highlightRows.length === 0 && (
                <Text style={[type.support, { padding: 10 }]}>
                  No bookmarks or highlights yet. Long-press a paragraph to highlight it; the
                  bookmark button in the toolbar marks the page.
                </Text>
              )}
              {marks.bookmarks
                .slice()
                .sort((a, b) => a.page - b.page)
                .map((mark) => (
                  <SheetRow
                    key={mark.id}
                    icon="bookmark"
                    title={`Page ${mark.page}`}
                    subtitle={chapterTitleFor(source?.toc ?? [], mark.page)}
                    onPress={() => jumpTo(mark.page)}
                  />
                ))}
              {highlightRows.map((row) => (
                <SheetRow
                  key={row.id}
                  icon="color-wand-outline"
                  title={row.anchor_text ? `“${row.anchor_text.slice(0, 80)}${row.anchor_text.length > 80 ? '…' : ''}”` : 'Highlight'}
                  subtitle={row.page ? `Page ${row.page}${row.chapter ? ` · ${row.chapter}` : ''}` : undefined}
                  onPress={() => row.page && jumpTo(row.page)}
                />
              ))}
            </>
          )}

          {navSheet === 'notes' &&
            (noteRows.length ? (
              noteRows.map((row) => (
                <SheetRow
                  key={row.id}
                  icon="create-outline"
                  title={row.body || 'Note'}
                  subtitle={`${row.page ? `Page ${row.page}` : ''}${
                    row.anchor_text ? ` · “${row.anchor_text.slice(0, 60)}…”` : ''
                  }`}
                  onPress={() => row.page && jumpTo(row.page)}
                />
              ))
            ) : (
              <Text style={[type.support, { padding: 10 }]}>
                No notes in this book yet. Long-press a paragraph and choose “Add note”.
              </Text>
            ))}
        </ScrollView>
      </Sheet>

      {/* Selection sheet — highlight / note on a long-pressed paragraph. */}
      <Sheet
        visible={!!selection}
        onClose={() => {
          setSelection(null);
          setNoteDraft(null);
        }}
      >
        {selection && (
          <View style={{ gap: 14 }}>
            <Text style={[type.support, { fontStyle: 'italic' }]} numberOfLines={3}>
              “{selection.text}”
            </Text>

            {noteDraft === null ? (
              <>
                {selection.existing.map((annotation) => (
                  <View
                    key={annotation.id}
                    style={{
                      borderTopWidth: StyleSheet.hairlineWidth,
                      borderTopColor: colors.border,
                      paddingTop: 12,
                      gap: 6,
                    }}
                  >
                    <Text style={type.eyebrow}>{annotation.kind}</Text>
                    {!!annotation.body && <Text style={type.body}>{annotation.body}</Text>}
                    <Pressable
                      onPress={() => void marks.remove(annotation.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="Remove this mark"
                    >
                      <Text style={{ color: colors.danger, fontSize: 13 }}>Remove</Text>
                    </Pressable>
                  </View>
                ))}

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <GhostButton
                    style={{ flex: 1 }}
                    label={
                      selection.existing.some((a) => a.kind === 'highlight')
                        ? 'Unhighlight'
                        : 'Highlight'
                    }
                    onPress={() => {
                      void (async () => {
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
                      })();
                    }}
                  />
                  <GhostButton
                    style={{ flex: 1 }}
                    label="Add note"
                    onPress={() => setNoteDraft('')}
                  />
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
                  <View style={{ flex: 1 }}>
                    <GhostButton label="Cancel" onPress={() => setNoteDraft(null)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <PrimaryButton label="Save note" onPress={() => void saveNote()} />
                  </View>
                </View>
              </>
            )}
          </View>
        )}
      </Sheet>
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Pieces                                                                    */
/* ------------------------------------------------------------------------ */

function ToolbarButton({
  icon,
  label,
  onPress,
  theme,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  theme: ReaderTheme;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
        backgroundColor: pressed ? theme.chromeBorder : 'transparent',
      })}
    >
      <Ionicons name={icon} size={19} color={theme.muted} />
    </Pressable>
  );
}

/** The chapter a page falls in, for bookmark subtitles. */
function chapterTitleFor(toc: PdfTocEntry[], page: number): string | undefined {
  const entry = chapterAt(toc, page);
  return entry?.title;
}

/** One tappable row in the Marks / Notes sheets. */
function SheetRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 10,
        borderRadius: radius.sm,
        backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
      })}
    >
      <Ionicons name={icon} size={16} color={colors.textMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.textStrong, fontSize: 14 }} numberOfLines={2}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={type.label} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

/**
 * Draggable progress slider. Pure PanResponder on a measured track — no
 * native slider dependency, which keeps the APK build untouched.
 */
function PageSlider({
  page,
  pageCount,
  theme,
  onSeek,
}: {
  page: number;
  pageCount: number;
  theme: ReaderTheme;
  onSeek: (page: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const widthRef = useRef(0);
  widthRef.current = width;
  const countRef = useRef(pageCount);
  countRef.current = pageCount;
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;

  const pageFor = (x: number): number => {
    const w = widthRef.current;
    if (w <= 0) return 1;
    const fraction = Math.max(0, Math.min(1, x / w));
    return Math.max(1, Math.min(countRef.current, Math.round(fraction * (countRef.current - 1)) + 1));
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => setPreview(pageFor(event.nativeEvent.locationX)),
        onPanResponderMove: (event) => setPreview(pageFor(event.nativeEvent.locationX)),
        onPanResponderRelease: (event) => {
          const target = pageFor(event.nativeEvent.locationX);
          setPreview(null);
          seekRef.current(target);
        },
        onPanResponderTerminate: () => setPreview(null),
      }),
    [],
  );

  const shown = preview ?? page;
  const fraction = pageCount > 1 ? (shown - 1) / (pageCount - 1) : 0;

  return (
    <View style={{ gap: 4 }}>
      {preview !== null && (
        <Text style={{ color: theme.muted, fontSize: 11.5, textAlign: 'center' }}>
          Page {preview}
        </Text>
      )}
      <View
        {...responder.panHandlers}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel="Reading position"
        accessibilityValue={{ min: 1, max: pageCount, now: shown }}
        style={{ height: 28, justifyContent: 'center' }}
      >
        <View
          pointerEvents="none"
          style={{
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.chromeBorder,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${fraction * 100}%`,
              height: '100%',
              backgroundColor: theme.muted,
            }}
          />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: Math.max(0, fraction * Math.max(0, width - 14)),
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: theme.text,
          }}
        />
      </View>
    </View>
  );
}

function Stepper({
  label,
  value,
  onLess,
  onMore,
}: {
  label: string;
  value: string;
  onLess: () => void;
  onMore: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={[type.body, { flex: 1, color: colors.text }]}>{label}</Text>
      <Pressable
        onPress={onLess}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label.toLowerCase()}`}
        style={[shared.ghostButton, { paddingVertical: 8, paddingHorizontal: 16 }]}
      >
        <Text style={{ color: colors.text, fontSize: 16 }}>−</Text>
      </Pressable>
      <Text style={{ color: colors.textMuted, fontSize: 14, width: 44, textAlign: 'center' }}>
        {value}
      </Text>
      <Pressable
        onPress={onMore}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label.toLowerCase()}`}
        style={[shared.ghostButton, { paddingVertical: 8, paddingHorizontal: 16 }]}
      >
        <Text style={{ color: colors.text, fontSize: 16 }}>+</Text>
      </Pressable>
    </View>
  );
}
