/**
 * The reader — the web app's reading environment, as a phone screen.
 *
 * It carries the same controls as `MyProDarkReader`: the two reading modes,
 * the three background themes, the font-size / line-spacing / reading-width
 * settings, in-book search, the Contents / Pages / Marks / Notes
 * destinations, the five-colour highlight palette and the five annotation
 * kinds, with the same filter, sort and search over them.
 *
 * What it renders is the extracted text the device holding the PDF produced.
 * There is no PDF file here to rasterise, and that is the architecture rather
 * than an omission: the file stays on the device that imported it, and only
 * the structured text syncs. So "Pages" is a page map rather than a strip of
 * thumbnails, and everything else behaves as it does in the browser.
 *
 * Reading position still syncs through Render, so the web app agrees.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, FlatList, PanResponder, Pressable, ScrollView, StyleSheet, View,
  type ViewToken,
} from 'react-native';
import { Text, TextInput } from '../components/Typography';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import {
  chapterAt, type AnnotationKind, type AnnotationRow, type PdfTocEntry,
} from '@mypro/shared';
import { client } from '../lib/client';
import { useBookText } from '../lib/useBookText';
import { anchorKey, useAnnotations } from '../lib/useAnnotations';
import { GhostButton, PrimaryButton, Sheet, type IconName } from '../components/ui';
import { colors, radius, shared, space, type } from '../theme';
import type { BookSummary } from './LibraryScreen';

/** A horizontal drag this far (and mostly sideways) turns the page. */
const SWIPE_DISTANCE = 60;
const SWIPE_SLOPE = 1.4;

/* ------------------------------------------------------------------------ */
/* The web's reading options, value for value                                */
/* ------------------------------------------------------------------------ */

type ReadingMode = 'paginated' | 'continuous';
type ReaderThemeName = 'dark' | 'sepia' | 'paper';

interface ReaderTheme {
  name: ReaderThemeName;
  label: string;
  /** Which way `expo-blur` should tint the chrome behind the page. */
  dark: boolean;
  bg: string;
  /** The page panel, which sits a step off the canvas as it does on the web. */
  sheet: string;
  text: string;
  muted: string;
  faint: string;
  chrome: string;
  chromeBorder: string;
}

const THEMES: Record<ReaderThemeName, ReaderTheme> = {
  dark: {
    name: 'dark',
    label: 'Dark',
    dark: true,
    bg: '#050607',
    sheet: '#111317',
    text: '#E9E9EC',
    muted: '#A0A4AD',
    faint: '#737983',
    chrome: 'rgba(17,19,23,0.78)',
    chromeBorder: 'rgba(255,255,255,0.12)',
  },
  sepia: {
    name: 'sepia',
    label: 'Sepia',
    dark: false,
    bg: '#EFE4D0',
    sheet: '#F6EDDC',
    text: '#3B3226',
    muted: '#6E6353',
    faint: '#998D7A',
    chrome: 'rgba(238,227,207,0.82)',
    chromeBorder: 'rgba(59,50,38,0.16)',
  },
  paper: {
    name: 'paper',
    label: 'Paper',
    dark: false,
    bg: '#F2F2F0',
    sheet: '#FFFFFF',
    text: '#1C1C1E',
    muted: '#5B5B60',
    faint: '#8E8E93',
    chrome: 'rgba(250,250,248,0.82)',
    chromeBorder: 'rgba(0,0,0,0.12)',
  },
};

/** `[1.5, 1.7, 1.9]` — Snug, Normal, Airy. */
const LINE_SPACINGS: { value: number; label: string }[] = [
  { value: 1.5, label: 'Snug' },
  { value: 1.7, label: 'Normal' },
  { value: 1.9, label: 'Airy' },
];

/**
 * The web's 640 / 720 / 800 column widths, as the side margins a phone can
 * actually offer: a narrower column is a wider margin.
 */
const READING_WIDTHS: { value: number; label: string }[] = [
  { value: 34, label: 'Narrow' },
  { value: 24, label: 'Comfort' },
  { value: 16, label: 'Wide' },
];

const FONT_MIN = 14;
const FONT_MAX = 22;

/** `--ann-*` — the accent palette the web marks passages with. */
const ANNOTATION_COLORS: Record<string, string> = {
  yellow: '#e8d27a',
  lavender: '#b69af5',
  cyan: '#70dce5',
  mint: '#83d9b0',
  coral: '#f5938b',
};
const HIGHLIGHT_COLORS = ['yellow', 'lavender', 'cyan', 'mint', 'coral'] as const;

const ANNOTATION_META: Record<AnnotationKind, { label: string; color: string; icon: IconName }> = {
  note: { label: 'Note', color: 'lavender', icon: 'create-outline' },
  quote: { label: 'Quote', color: 'cyan', icon: 'chatbox-ellipses-outline' },
  summary: { label: 'Summary', color: 'mint', icon: 'document-text-outline' },
  question: { label: 'Question', color: 'coral', icon: 'help-circle-outline' },
  highlight: { label: 'Highlight', color: 'yellow', icon: 'color-wand-outline' },
};

type AnnFilter = 'All' | AnnotationKind | 'bookmark';
type AnnSort = 'page' | 'recent' | 'type';

const ANN_FILTERS: { id: AnnFilter; label: string }[] = [
  { id: 'All', label: 'All' },
  { id: 'note', label: 'Notes' },
  { id: 'highlight', label: 'Highlights' },
  { id: 'quote', label: 'Quotes' },
  { id: 'summary', label: 'Summaries' },
  { id: 'question', label: 'Questions' },
  { id: 'bookmark', label: 'Bookmarks' },
];

/* ------------------------------------------------------------------------ */
/* Stored preferences                                                        */
/* ------------------------------------------------------------------------ */

interface ReaderPrefs {
  theme: ReaderThemeName;
  fontSize: number;
  lineHeight: number;
  mode: ReadingMode;
  /** The horizontal page margin, from `READING_WIDTHS`. */
  margin: number;
}

const PREFS_KEY = 'mypro.readerPrefs';
const DEFAULT_PREFS: ReaderPrefs = {
  theme: 'dark',
  fontSize: 17,
  lineHeight: 1.7,
  mode: 'continuous',
  margin: 24,
};

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
              ? Math.min(FONT_MAX, Math.max(FONT_MIN, parsed.fontSize))
              : DEFAULT_PREFS.fontSize,
          lineHeight:
            typeof parsed.lineHeight === 'number'
              ? Math.min(2, Math.max(1.4, parsed.lineHeight))
              : DEFAULT_PREFS.lineHeight,
          mode: parsed.mode === 'paginated' ? 'paginated' : 'continuous',
          margin: typeof parsed.margin === 'number' ? parsed.margin : DEFAULT_PREFS.margin,
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

/** What a long-press opens on. */
interface Selection {
  page: number;
  paragraph: number;
  text: string;
  existing: AnnotationRow[];
}

/** One in-book search hit. */
interface SearchHit {
  page: number;
  paragraph: number;
  snippet: string;
}

type NavTab = 'contents' | 'pages' | 'marks' | 'notes';

/* ------------------------------------------------------------------------ */
/* The screen                                                                */
/* ------------------------------------------------------------------------ */

export function ReaderScreen({ book, onClose }: { book: BookSummary; onClose: () => void }) {
  const { source } = useBookText(book.id);
  const [page, setPage] = useState(book.currentPage || 1);
  const [prefs, updatePrefs] = useReaderPrefs();
  const [chromeVisible, setChromeVisible] = useState(true);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [navSheet, setNavSheet] = useState<NavTab | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [noteDraft, setNoteDraft] = useState<{ kind: AnnotationKind; body: string } | null>(null);
  const [annFilter, setAnnFilter] = useState<AnnFilter>('All');
  const [annSort, setAnnSort] = useState<AnnSort>('page');
  const [annSearch, setAnnSearch] = useState('');

  const scrollRef = useRef<ScrollView>(null);
  const flowRef = useRef<FlatList<number>>(null);
  const status = source?.status ?? 'loading';
  const pageCount = source?.pageCount || book.totalPages || 0;
  const marks = useAnnotations(book.id);
  const theme = THEMES[prefs.theme];

  const chapter = useMemo(() => chapterAt(source?.toc ?? [], page), [source, page, status]);
  const bookmarked = marks.bookmarks.some((mark) => mark.page === page);
  const percent = pageCount ? Math.min(100, Math.round((page / pageCount) * 100)) : 0;
  const continuous = prefs.mode === 'continuous';

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

  /** Reading downward tucks the chrome away; a pause brings it back. */
  const lastOffset = useRef(0);
  const chromeIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onReadingScroll = (offset: number) => {
    const delta = offset - lastOffset.current;
    lastOffset.current = offset;
    if (Math.abs(delta) > 6) setChromeVisible(!(delta > 0 && offset > 80));
    if (chromeIdle.current) clearTimeout(chromeIdle.current);
    chromeIdle.current = setTimeout(() => setChromeVisible(true), 900);
  };
  useEffect(
    () => () => {
      if (chromeIdle.current) clearTimeout(chromeIdle.current);
    },
    [],
  );

  /* Page turning (paginated) ---------------------------------------------- */
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
           vertical scrolling still belongs to the ScrollView and taps still
           reach the paragraphs. */
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
    if (continuous) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    lastOffset.current = 0;
  }, [page, continuous]);

  /* Progress sync ---------------------------------------------------------- */
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

  /* In-book search --------------------------------------------------------- */
  /**
   * Searches the synced text rather than the file. Capped, because a long
   * book with a common word would otherwise build a list nobody scrolls.
   */
  const hits = useMemo<SearchHit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2 || !source || !pageCount) return [];
    const found: SearchHit[] = [];
    for (let n = 1; n <= pageCount && found.length < 120; n++) {
      const content = source.page(n);
      if (!content?.paragraphs?.length) continue;
      content.paragraphs.forEach((paragraph, index) => {
        if (found.length >= 120) return;
        const at = paragraph.toLowerCase().indexOf(needle);
        if (at === -1) return;
        const from = Math.max(0, at - 40);
        found.push({
          page: n,
          paragraph: index,
          snippet:
            (from > 0 ? '…' : '') +
            paragraph.slice(from, at + needle.length + 60).trim() +
            '…',
        });
      });
    }
    return found;
  }, [query, source, pageCount, status]);

  /* Helpers ---------------------------------------------------------------- */
  const message = (): string => {
    if (status === 'error') return source?.error || 'This book could not be opened.';
    if (status === 'unavailable') {
      return 'No text for this book yet. Open it once in the web app, on the device that holds the PDF, and it will sync here.';
    }
    if (status === 'scanned') {
      return 'This PDF has no text layer — it looks scanned. Open it once in the web app and it will be read with text recognition, then sync here.';
    }
    if (status === 'loading') return 'Fetching the text…';
    return 'This page is not in the synced text.';
  };

  const openSelection = (atPage: number, paragraph: number, text: string) => {
    setSelection({
      page: atPage,
      paragraph,
      text,
      existing: marks.byAnchor.get(anchorKey(atPage, paragraph)) ?? [],
    });
  };

  const saveNote = async () => {
    if (!selection || !noteDraft) return;
    const body = noteDraft.body.trim();
    if (body) {
      await marks.add({
        kind: noteDraft.kind,
        page: selection.page,
        paragraph: selection.paragraph,
        anchorText: selection.text,
        body,
        chapter: chapter?.title ?? null,
        color: ANNOTATION_META[noteDraft.kind].color,
      });
    }
    setNoteDraft(null);
    setSelection(null);
  };

  const jumpTo = (target: number) => {
    setNavSheet(null);
    setSearchOpen(false);
    if (target < 1 || (pageCount && target > pageCount)) return;
    setPage(target);
    if (continuous) {
      // The flow is indexed from zero; keep the two in step.
      flowRef.current?.scrollToIndex({ index: target - 1, animated: false });
    }
  };

  /* The annotation list behind Marks and Notes ----------------------------- */
  const annotations = useMemo(() => {
    const needle = annSearch.trim().toLowerCase();
    let rows = marks.rows.filter((row) => {
      if (annFilter === 'bookmark') return false;
      if (annFilter !== 'All' && row.kind !== annFilter) return false;
      if (!needle) return true;
      return (
        (row.body ?? '').toLowerCase().includes(needle) ||
        (row.anchor_text ?? '').toLowerCase().includes(needle) ||
        (row.chapter ?? '').toLowerCase().includes(needle)
      );
    });
    rows = [...rows].sort((a, b) => {
      if (annSort === 'page') return (a.page ?? 0) - (b.page ?? 0);
      if (annSort === 'recent') return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      return a.kind.localeCompare(b.kind);
    });
    return rows;
  }, [marks.rows, annFilter, annSort, annSearch]);

  /** One page's paragraphs, with their marks applied. */
  const renderPage = (pageNumber: number) => {
    const content = source?.page(pageNumber) ?? null;
    if (!content?.paragraphs?.length) {
      return (
        <View
          key={`empty-${pageNumber}`}
          style={{
            borderRadius: radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.chromeBorder,
            padding: space.lg,
            marginBottom: 18,
          }}
        >
          <Text style={{ color: theme.muted, fontSize: 14.5, lineHeight: 21 }}>
            {content?.empty ? 'This page has no text.' : message()}
          </Text>
        </View>
      );
    }

    return (
      <View
        key={`page-${pageNumber}`}
        style={{
          backgroundColor: theme.sheet,
          borderRadius: radius.lg,
          paddingHorizontal: prefs.margin,
          paddingTop: 26,
          paddingBottom: 22,
          marginBottom: continuous ? 14 : 0,
          gap: Math.round(prefs.fontSize * 1.05),
        }}
      >
        {content.paragraphs.map((paragraph, index) => {
          const rows = marks.byAnchor.get(anchorKey(pageNumber, index)) ?? [];
          const highlight = rows.find((row) => row.kind === 'highlight');
          const noted = rows.some((row) => row.kind !== 'highlight');
          const wash = highlight
            ? `${ANNOTATION_COLORS[highlight.color ?? 'yellow'] ?? ANNOTATION_COLORS.yellow}3d`
            : 'transparent';
          return (
            <Pressable
              key={`${pageNumber}-${index}`}
              onLongPress={() => openSelection(pageNumber, index, paragraph)}
              onPress={() => {
                /* A marked paragraph opens its marks; anywhere else, a tap
                   toggles the chrome — the Apple Books gesture. */
                if (rows.length) openSelection(pageNumber, index, paragraph);
                else setChromeVisible((visible) => !visible);
              }}
              delayLongPress={280}
            >
              <Text
                style={{
                  color: theme.text,
                  fontSize: prefs.fontSize,
                  lineHeight: Math.round(prefs.fontSize * prefs.lineHeight),
                  /* A wash, never a solid fill: a solid background would
                     erase the type underneath it. */
                  backgroundColor: wash,
                }}
              >
                {paragraph}
                {noted ? <Text style={{ color: theme.faint }}> ◦</Text> : null}
              </Text>
            </Pressable>
          );
        })}

        {/* `.sheet-bottom-meta` — a quiet page number for orientation. */}
        <Text
          style={{
            color: theme.faint,
            fontSize: 10.5,
            letterSpacing: 1,
            textAlign: 'right',
            marginTop: 6,
          }}
        >
          PAGE {pageNumber}
          {pageCount ? ` OF ${pageCount}` : ''}
        </Text>
      </View>
    );
  };

  /** Which page the flow is showing, so the dock and chapter keep up. */
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((item) => item.isViewable);
    if (first?.index != null) setPage(first.index + 1);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 40 }).current;

  const pages = useMemo(
    () => Array.from({ length: Math.max(pageCount, 1) }, (_, index) => index + 1),
    [pageCount],
  );

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
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.chromeBorder,
          paddingTop: 50,
          paddingBottom: 10,
          paddingHorizontal: 12,
          overflow: 'hidden',
        }}
      >
        <BlurView
          intensity={38}
          tint={theme.dark ? 'dark' : 'light'}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.chrome }]}
          experimentalBlurMethod="dimezisBlurView"
        />
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
            icon="search"
            label="Search in book"
            theme={theme}
            onPress={() => setSearchOpen(true)}
          />
          <ToolbarButton
            icon={bookmarked ? 'bookmark' : 'bookmark-outline'}
            label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
            theme={theme}
            onPress={() => void marks.toggleBookmark(page)}
          />
          <ToolbarButton
            icon="text"
            label="Reading settings"
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

      {/* The page, or the flow of pages. */}
      {continuous ? (
        <FlatList
          ref={flowRef}
          data={pages}
          keyExtractor={(item) => `p${item}`}
          renderItem={({ item }) => renderPage(item)}
          initialScrollIndex={Math.max(0, (book.currentPage || 1) - 1)}
          onScrollToIndexFailed={() => undefined}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={viewabilityConfig}
          onScroll={(event) => onReadingScroll(event.nativeEvent.contentOffset.y)}
          scrollEventThrottle={32}
          windowSize={5}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          contentContainerStyle={{
            paddingTop: 110,
            paddingBottom: 150,
            paddingHorizontal: 12,
          }}
        />
      ) : (
        <ScrollView
          ref={scrollRef}
          onScroll={(event) => onReadingScroll(event.nativeEvent.contentOffset.y)}
          scrollEventThrottle={32}
          contentContainerStyle={{
            paddingTop: 110,
            paddingBottom: 150,
            paddingHorizontal: 12,
          }}
          {...swipe.panHandlers}
        >
          {renderPage(page)}
          <Text
            style={{
              color: theme.faint,
              fontSize: 11.5,
              textAlign: 'center',
              marginTop: 14,
            }}
          >
            Swipe to turn · long-press a paragraph to mark it
          </Text>
        </ScrollView>
      )}

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
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.chromeBorder,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: 14,
          gap: 10,
          overflow: 'hidden',
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.4,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <BlurView
          intensity={38}
          tint={theme.dark ? 'dark' : 'light'}
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.chrome }]}
          experimentalBlurMethod="dimezisBlurView"
        />
        {pageCount > 1 && (
          <PageSlider page={page} pageCount={pageCount} theme={theme} onSeek={jumpTo} />
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ToolbarButton
            icon="chevron-back"
            label="Previous page"
            theme={theme}
            disabled={page <= 1}
            onPress={() => (continuous ? jumpTo(page - 1) : turn.current(-1))}
          />
          <Text
            style={{
              flex: 1,
              textAlign: 'center',
              color: theme.muted,
              fontSize: 12.5,
            }}
          >
            {pageCount ? `Page ${page} of ${pageCount} · ${percent}%` : `Page ${page}`}
          </Text>
          <ToolbarButton
            icon="chevron-forward"
            label="Next page"
            theme={theme}
            disabled={!!pageCount && page >= pageCount}
            onPress={() => (continuous ? jumpTo(page + 1) : turn.current(1))}
          />
        </View>
      </Animated.View>

      {/* Reading settings — the web's sheet, control for control. */}
      <Sheet
        visible={appearanceOpen}
        onClose={() => setAppearanceOpen(false)}
        kicker="Reading environment"
        title="Display & Theme"
      >
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 18, paddingBottom: 4 }}>
          <Setting label="Reading mode">
            <Options
              options={[
                { value: 'paginated', label: 'Paginated' },
                { value: 'continuous', label: 'Continuous' },
              ]}
              value={prefs.mode}
              onChange={(mode) => updatePrefs({ mode })}
            />
          </Setting>

          <Setting label="Background theme">
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(Object.values(THEMES) as ReaderTheme[]).map((option) => {
                const active = prefs.theme === option.name;
                return (
                  <Pressable
                    key={option.name}
                    onPress={() => updatePrefs({ theme: option.name })}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} theme`}
                    accessibilityState={{ selected: active }}
                    style={{
                      flex: 1,
                      alignItems: 'center',
                      gap: 8,
                      paddingVertical: 12,
                      borderRadius: radius.md,
                      borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                      borderColor: active ? colors.violet : colors.borderStrong,
                      backgroundColor: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        backgroundColor: option.bg,
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: 'rgba(255,255,255,0.25)',
                      }}
                    />
                    <Text style={{ color: colors.text, fontSize: 12.5 }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Setting>

          <Setting label={`Font size (${prefs.fontSize}px)`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <StepButton
                label="Decrease font size"
                glyph="A−"
                onPress={() =>
                  updatePrefs({ fontSize: Math.max(FONT_MIN, prefs.fontSize - 1) })
                }
              />
              <View style={{ flex: 1 }}>
                <Track
                  fraction={(prefs.fontSize - FONT_MIN) / (FONT_MAX - FONT_MIN)}
                  onSeek={(f) =>
                    updatePrefs({
                      fontSize: Math.round(FONT_MIN + f * (FONT_MAX - FONT_MIN)),
                    })
                  }
                />
              </View>
              <StepButton
                label="Increase font size"
                glyph="A+"
                onPress={() =>
                  updatePrefs({ fontSize: Math.min(FONT_MAX, prefs.fontSize + 1) })
                }
              />
            </View>
          </Setting>

          <Setting label="Line spacing">
            <Options
              options={LINE_SPACINGS.map((s) => ({ value: s.value, label: s.label }))}
              value={prefs.lineHeight}
              onChange={(lineHeight) => updatePrefs({ lineHeight })}
            />
          </Setting>

          <Setting label="Reading width">
            <Options
              options={READING_WIDTHS.map((w) => ({ value: w.value, label: w.label }))}
              value={prefs.margin}
              onChange={(margin) => updatePrefs({ margin })}
            />
          </Setting>

          <Text style={[type.meta, { marginTop: 2 }]}>
            Marks stay anchored to their passage when you change size, width, or mode.
          </Text>
        </ScrollView>
      </Sheet>

      {/* In-book search */}
      <Sheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        kicker="Search"
        title={`In ${book.title}`}
      >
        <View style={{ gap: 12 }}>
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
              placeholder="Find a word or phrase"
              placeholderTextColor="rgba(255,255,255,0.44)"
              value={query}
              onChangeText={setQuery}
              autoFocus
              returnKeyType="search"
              accessibilityLabel="Search in this book"
            />
          </View>

          {query.trim().length < 2 ? (
            <Text style={type.meta}>Type at least two characters.</Text>
          ) : hits.length === 0 ? (
            <Text style={type.meta}>No matches in the synced text.</Text>
          ) : (
            <>
              <Text style={type.meta}>
                {hits.length === 120 ? 'First 120 matches' : `${hits.length} matches`}
              </Text>
              <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 2 }}>
                {hits.map((hit) => (
                  <Pressable
                    key={`${hit.page}-${hit.paragraph}`}
                    onPress={() => jumpTo(hit.page)}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to page ${hit.page}`}
                    style={({ pressed }) => ({
                      gap: 4,
                      paddingVertical: 11,
                      paddingHorizontal: 10,
                      borderRadius: radius.sm,
                      backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : 'transparent',
                    })}
                  >
                    <Text style={type.label}>Page {hit.page}</Text>
                    <Text style={{ color: colors.textStrong, fontSize: 13.5, lineHeight: 19 }}>
                      {hit.snippet}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </Sheet>

      {/* Contents · Pages · Marks · Notes */}
      <Sheet visible={navSheet !== null} onClose={() => setNavSheet(null)}>
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: space.md }}>
          {(
            [
              { key: 'contents', label: 'Contents' },
              { key: 'pages', label: 'Pages' },
              { key: 'marks', label: 'Marks' },
              { key: 'notes', label: 'Notes' },
            ] as { key: NavTab; label: string }[]
          ).map((tab) => {
            const active = navSheet === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setNavSheet(tab.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 9,
                  borderRadius: radius.sm,
                  backgroundColor: active ? colors.text : 'transparent',
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: active ? colors.text : colors.border,
                }}
              >
                <Text
                  style={{
                    color: active ? '#000000' : colors.textMuted,
                    fontSize: 13,
                    fontWeight: active ? '600' : '400',
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {navSheet === 'contents' && (
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 2 }}>
            {(source?.toc?.length ?? 0) > 0 ? (
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
                        color: chapter && chapter.id === entry.id ? colors.text : colors.textStrong,
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
              <Text style={[type.meta, { padding: 10 }]}>
                This book has no table of contents in its synced text.
              </Text>
            )}
          </ScrollView>
        )}

        {navSheet === 'pages' && (
          <ScrollView style={{ maxHeight: 420 }}>
            {/* The web shows page thumbnails. There is no PDF on the phone to
                draw them from, so this is the same navigation as a map of
                pages, marking the one you are on and the ones you marked. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {pages.map((number) => {
                const current = number === page;
                const hasMark =
                  marks.bookmarks.some((mark) => mark.page === number) ||
                  marks.rows.some((row) => row.page === number);
                return (
                  <Pressable
                    key={number}
                    onPress={() => jumpTo(number)}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to page ${number}`}
                    accessibilityState={{ selected: current }}
                    style={{
                      width: 52,
                      height: 62,
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      borderRadius: radius.sm,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: current ? colors.text : colors.border,
                      backgroundColor: current ? colors.text : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <Text
                      style={{
                        color: current ? '#000000' : colors.textStrong,
                        fontSize: 14,
                        fontWeight: current ? '700' : '400',
                      }}
                    >
                      {number}
                    </Text>
                    <View
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        backgroundColor: hasMark
                          ? current
                            ? 'rgba(0,0,0,0.5)'
                            : colors.violet
                          : 'transparent',
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        )}

        {navSheet === 'marks' && (
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 2 }}>
            {marks.bookmarks.length === 0 ? (
              <Text style={[type.meta, { padding: 10 }]}>
                No bookmarks yet. The bookmark button in the toolbar marks the page you are on.
              </Text>
            ) : (
              marks.bookmarks
                .slice()
                .sort((a, b) => a.page - b.page)
                .map((mark) => (
                  <SheetRow
                    key={mark.id}
                    icon="bookmark"
                    tint={colors.text}
                    title={`Page ${mark.page}`}
                    subtitle={chapterTitleFor(source?.toc ?? [], mark.page)}
                    onPress={() => jumpTo(mark.page)}
                  />
                ))
            )}
          </ScrollView>
        )}

        {navSheet === 'notes' && (
          <View style={{ gap: 10 }}>
            <View
              style={{
                height: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 14,
                borderWidth: 1,
                borderColor: colors.borderStrong,
                borderRadius: radius.md,
                backgroundColor: 'rgba(255,255,255,0.04)',
              }}
            >
              <Ionicons name="search" size={15} color={colors.textSoft} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontSize: 15, paddingVertical: 0 }}
                placeholder="Search your marks"
                placeholderTextColor="rgba(255,255,255,0.44)"
                value={annSearch}
                onChangeText={setAnnSearch}
                accessibilityLabel="Search your marks"
              />
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ gap: 6 }}
            >
              {ANN_FILTERS.filter((f) => f.id !== 'bookmark').map((filter) => {
                const active = annFilter === filter.id;
                return (
                  <Pressable
                    key={filter.id}
                    onPress={() => setAnnFilter(filter.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={{
                      height: 32,
                      paddingHorizontal: 12,
                      borderRadius: radius.pill,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                    }}
                  >
                    <Text
                      style={{
                        color: active ? colors.text : colors.textMuted,
                        fontSize: 12.5,
                      }}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={type.label}>Sort</Text>
              <Options
                options={[
                  { value: 'page', label: 'Page' },
                  { value: 'recent', label: 'Recent' },
                  { value: 'type', label: 'Type' },
                ]}
                value={annSort}
                onChange={setAnnSort}
              />
            </View>

            <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: 2 }}>
              {annotations.length === 0 ? (
                <Text style={[type.meta, { padding: 10 }]}>
                  Nothing here yet. Long-press a passage to highlight it or attach a note.
                </Text>
              ) : (
                annotations.map((row) => (
                  <SheetRow
                    key={row.id}
                    icon={ANNOTATION_META[row.kind]?.icon ?? 'create-outline'}
                    tint={
                      ANNOTATION_COLORS[row.color ?? ANNOTATION_META[row.kind]?.color ?? 'yellow'] ??
                      colors.text
                    }
                    title={
                      row.body ||
                      (row.anchor_text
                        ? `“${row.anchor_text.slice(0, 80)}${
                            row.anchor_text.length > 80 ? '…' : ''
                          }”`
                        : ANNOTATION_META[row.kind]?.label ?? 'Mark')
                    }
                    subtitle={`${ANNOTATION_META[row.kind]?.label ?? row.kind}${
                      row.page ? ` · Page ${row.page}` : ''
                    }${row.chapter ? ` · ${row.chapter}` : ''}`}
                    onPress={() => row.page && jumpTo(row.page)}
                  />
                ))
              )}
            </ScrollView>
          </View>
        )}
      </Sheet>

      {/* Selection — highlight in any of five colours, or attach a mark. */}
      <Sheet
        visible={!!selection}
        onClose={() => {
          setSelection(null);
          setNoteDraft(null);
        }}
      >
        {selection && (
          <View style={{ gap: 14 }}>
            <Text style={[type.meta, { fontStyle: 'italic' }]} numberOfLines={3}>
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
                    <Text
                      style={[
                        type.label,
                        {
                          color:
                            ANNOTATION_COLORS[
                              annotation.color ?? ANNOTATION_META[annotation.kind]?.color ?? 'yellow'
                            ] ?? colors.textSoft,
                        },
                      ]}
                    >
                      {ANNOTATION_META[annotation.kind]?.label ?? annotation.kind}
                    </Text>
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

                {/* The five-colour palette, as the web's highlight picker. */}
                <View style={{ gap: 8 }}>
                  <Text style={type.label}>Highlight</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {HIGHLIGHT_COLORS.map((name) => {
                      const existing = selection.existing.find((a) => a.kind === 'highlight');
                      const active = existing?.color === name;
                      return (
                        <Pressable
                          key={name}
                          accessibilityRole="button"
                          accessibilityLabel={`Highlight ${name}`}
                          accessibilityState={{ selected: active }}
                          onPress={() => {
                            void (async () => {
                              if (existing) await marks.remove(existing.id);
                              if (!active) {
                                await marks.add({
                                  kind: 'highlight',
                                  page: selection.page,
                                  paragraph: selection.paragraph,
                                  anchorText: selection.text,
                                  chapter: chapter?.title ?? null,
                                  color: name,
                                });
                              }
                              setSelection(null);
                            })();
                          }}
                          style={{
                            flex: 1,
                            height: 40,
                            borderRadius: radius.sm,
                            backgroundColor: `${ANNOTATION_COLORS[name]}40`,
                            borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                            borderColor: active ? ANNOTATION_COLORS[name] : colors.border,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {active && (
                            <Ionicons name="checkmark" size={16} color={ANNOTATION_COLORS[name]} />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {/* The four written kinds the API knows. */}
                <View style={{ gap: 8 }}>
                  <Text style={type.label}>Add</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(['note', 'quote', 'summary', 'question'] as AnnotationKind[]).map((kind) => (
                      <Pressable
                        key={kind}
                        onPress={() => setNoteDraft({ kind, body: '' })}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${ANNOTATION_META[kind].label}`}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 7,
                          paddingHorizontal: 14,
                          height: 40,
                          borderRadius: radius.pill,
                          borderWidth: StyleSheet.hairlineWidth,
                          borderColor: colors.borderStrong,
                          backgroundColor: pressed
                            ? 'rgba(255,255,255,0.08)'
                            : 'rgba(255,255,255,0.03)',
                        })}
                      >
                        <Ionicons
                          name={ANNOTATION_META[kind].icon}
                          size={14}
                          color={ANNOTATION_COLORS[ANNOTATION_META[kind].color]}
                        />
                        <Text style={{ color: colors.text, fontSize: 13.5 }}>
                          {ANNOTATION_META[kind].label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text style={type.label}>{ANNOTATION_META[noteDraft.kind].label}</Text>
                <TextInput
                  style={[shared.input, { minHeight: 96, textAlignVertical: 'top' }]}
                  placeholder={
                    noteDraft.kind === 'question'
                      ? 'What do you want to come back to?'
                      : noteDraft.kind === 'summary'
                        ? 'Sum this passage up in your own words'
                        : noteDraft.kind === 'quote'
                          ? 'Why is this worth keeping?'
                          : 'What did this make you think?'
                  }
                  placeholderTextColor="rgba(255,255,255,0.44)"
                  value={noteDraft.body}
                  onChangeText={(body) => setNoteDraft({ ...noteDraft, body })}
                  multiline
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <GhostButton
                    label="Cancel"
                    onPress={() => setNoteDraft(null)}
                    style={{ flex: 1 }}
                  />
                  <PrimaryButton
                    label={`Save ${ANNOTATION_META[noteDraft.kind].label.toLowerCase()}`}
                    onPress={() => void saveNote()}
                    disabled={!noteDraft.body.trim()}
                    style={{ flex: 1 }}
                  />
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

/** A labelled block in the settings sheet (`.setting-label` + its control). */
function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 9 }}>
      <Text style={type.label}>{label}</Text>
      {children}
    </View>
  );
}

/** The web's segmented option rows, used for mode, spacing, width and sort. */
function Options<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        padding: 3,
        borderRadius: radius.sm,
        backgroundColor: 'rgba(255,255,255,0.06)',
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            style={{
              flex: 1,
              minHeight: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              backgroundColor: active ? 'rgba(255,255,255,0.16)' : 'transparent',
            }}
          >
            <Text
              style={{
                color: active ? colors.text : colors.textMuted,
                fontSize: 13,
                fontWeight: active ? '600' : '400',
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StepButton({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 44,
        height: 40,
        borderRadius: radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
        backgroundColor: pressed ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
      })}
    >
      <Text style={{ color: colors.text, fontSize: 15 }}>{glyph}</Text>
    </Pressable>
  );
}

/** A draggable track, for the font-size slider. */
function Track({
  fraction,
  onSeek,
}: {
  fraction: number;
  onSeek: (fraction: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  widthRef.current = width;
  const seek = useRef(onSeek);
  seek.current = onSeek;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) =>
          seek.current(clamp01(event.nativeEvent.locationX / (widthRef.current || 1))),
        onPanResponderMove: (event) =>
          seek.current(clamp01(event.nativeEvent.locationX / (widthRef.current || 1))),
      }),
    [],
  );

  const value = clamp01(fraction);
  return (
    <View
      {...responder.panHandlers}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel="Font size"
      style={{ height: 36, justifyContent: 'center' }}
    >
      <View
        pointerEvents="none"
        style={{
          height: 4,
          borderRadius: 2,
          backgroundColor: 'rgba(255,255,255,0.16)',
          overflow: 'hidden',
        }}
      >
        <View style={{ width: `${value * 100}%`, height: '100%', backgroundColor: colors.violet }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: Math.max(0, value * Math.max(0, width - 16)),
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: colors.text,
        }}
      />
    </View>
  );
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

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
  return chapterAt(toc, page)?.title;
}

/** One tappable row in the Marks / Notes lists. */
function SheetRow({
  icon,
  title,
  subtitle,
  tint = colors.textMuted,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  tint?: string;
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
      <Ionicons name={icon} size={16} color={tint} />
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
 * The dock's progress slider. Pure PanResponder on a measured track — no
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
    const fraction = clamp01(x / w);
    return Math.max(
      1,
      Math.min(countRef.current, Math.round(fraction * (countRef.current - 1)) + 1),
    );
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
          <View style={{ width: `${fraction * 100}%`, height: '100%', backgroundColor: theme.muted }} />
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
