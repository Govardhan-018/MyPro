import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  AlignLeft,
  AlignJustify,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  HelpCircle,
  Highlighter,
  Layers,
  List,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Plus,
  Quote,
  Search,
  SlidersHorizontal,
  StickyNote,
  Tag,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Info,
  Check,
} from "lucide-react";
import type {
  LibraryItem,
  ReaderTheme,
  BookmarkItem,
  NoteItem,
  HighlightItem,
  TocChapter,
  Annotation,
  AnnotationKind,
  AnnotationColor,
} from "../../types/library";
import {
  sampleBookPages,
  creativeActToc,
  type BookPageContent,
} from "../../data/sampleReadingData";
import { chapterAt } from "@mypro/shared";
import { usePdfText } from "../../lib/usePdfText";

interface MyProDarkReaderProps {
  book: LibraryItem;
  isOpen: boolean;
  onClose: () => void;
  onSaveProgress: (
    title: string,
    currentPage: number,
    totalPages: number,
    bookmarks: BookmarkItem[],
    notes: NoteItem[],
    highlights: HighlightItem[],
    annotations: Annotation[],
  ) => void;
  colorMode?: boolean;
}

type AnnFilter = "All" | AnnotationKind | "bookmark";
type AnnSort = "page" | "recent" | "type";
type ReadingMode = "paginated" | "continuous";

const ANNOTATION_META: Record<
  AnnotationKind,
  { label: string; plural: string; color: AnnotationColor; Icon: typeof StickyNote }
> = {
  note: { label: "Note", plural: "Notes", color: "lavender", Icon: StickyNote },
  quote: { label: "Quote", plural: "Quotes", color: "cyan", Icon: Quote },
  summary: { label: "Summary", plural: "Summaries", color: "mint", Icon: FileText },
  question: { label: "Question", plural: "Questions", color: "coral", Icon: HelpCircle },
  highlight: { label: "Highlight", plural: "Highlights", color: "yellow", Icon: Highlighter },
};

const HIGHLIGHT_COLORS: AnnotationColor[] = ["yellow", "lavender", "cyan", "mint", "coral"];

/** Enough hits to be useful; past this the count is shown as "200+". */
const SEARCH_LIMIT = 200;

/** The three spacings worth one tap; the slider covers everything between. */
const LINE_PRESETS = [
  { value: 1.5, label: "Snug" },
  { value: 1.7, label: "Normal" },
  { value: 1.9, label: "Airy" },
] as const;

/** Any spacing the slider can produce, not just the presets. */
const LINE_MIN = 1.2;
const LINE_MAX = 2.4;

/* ---- Display preferences -------------------------------------------------
 * Theme, type size, spacing, column width, ruled paper and reading mode are
 * how *you* read, not properties of one book, and they were state with a
 * hard-coded default — so every book opened back at dark/17px/continuous no
 * matter what you had set a minute earlier. They live on the device.
 * ------------------------------------------------------------------------ */
const PREFS_KEY = 'mypro.reader.display';

interface ReaderPrefs {
  theme: ReaderTheme;
  fontSize: number;
  lineSpacing: number;
  readingWidth: number;
  ruledPage: boolean;
  readingMode: ReadingMode;
}

const DEFAULT_PREFS: ReaderPrefs = {
  theme: 'dark',
  fontSize: 17,
  lineSpacing: 1.7,
  readingWidth: 720,
  ruledPage: false,
  readingMode: 'continuous',
};

function readPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Partial<ReaderPrefs>;
    // Validate rather than trust: a stale or hand-edited value must not be
    // able to render the page unreadable.
    const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
      allowed.includes(value as T) ? (value as T) : fallback;
    const clamp = (value: unknown, min: number, max: number, fallback: number) =>
      typeof value === 'number' && value >= min && value <= max ? value : fallback;
    return {
      theme: oneOf(saved.theme, ['dark', 'sepia', 'original'] as const, DEFAULT_PREFS.theme),
      fontSize: clamp(saved.fontSize, 14, 22, DEFAULT_PREFS.fontSize),
      // A free range now, not three fixed steps — the slider can land anywhere.
      lineSpacing: clamp(saved.lineSpacing, LINE_MIN, LINE_MAX, DEFAULT_PREFS.lineSpacing),
      readingWidth: oneOf(saved.readingWidth, [640, 720, 800] as const, DEFAULT_PREFS.readingWidth),
      ruledPage: saved.ruledPage === true,
      readingMode: oneOf(
        saved.readingMode,
        ['paginated', 'continuous'] as const,
        DEFAULT_PREFS.readingMode,
      ),
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / storage disabled — the session keeps them anyway */
  }
}

const ANN_FILTERS: { id: AnnFilter; label: string }[] = [
  { id: "All", label: "All" },
  { id: "note", label: "Notes" },
  { id: "highlight", label: "Highlights" },
  { id: "quote", label: "Quotes" },
  { id: "summary", label: "Summaries" },
  { id: "question", label: "Questions" },
  { id: "bookmark", label: "Bookmarks" },
];

/** Map a legacy HighlightItem color onto the annotation accent palette. */
function toAnnotationColor(color: string): AnnotationColor {
  if (color === "peach") return "coral";
  if (color === "monochrome") return "yellow";
  if (color === "lavender" || color === "cyan" || color === "mint" || color === "yellow") {
    return color;
  }
  return "yellow";
}

/** Map an annotation accent back onto the legacy HighlightItem palette. */
function toHighlightColor(color?: AnnotationColor): HighlightItem["color"] {
  if (color === "coral") return "peach";
  if (color === "yellow") return "monochrome";
  if (color === "lavender" || color === "cyan" || color === "mint") return color;
  return "monochrome";
}

/**
 * When an annotation was made, as a sortable number.
 *
 * `createdAt` is an ISO timestamp for anything loaded from the server and a
 * human phrase ("Just now", "Earlier") for the rest, so neither string
 * comparison nor `Date.parse` alone can order the list. Annotations created in
 * this session carry their time in their id, which covers the gap.
 */
function recencyOf(a: Annotation): number {
  const parsed = Date.parse(a.createdAt);
  if (!Number.isNaN(parsed)) return parsed;
  const fromId = /^ann-(\d+)$/.exec(a.id);
  return fromId ? Number(fromId[1]) : 0;
}

/** `createdAt` for the sidebar: an ISO stamp read as a date, anything else as-is. */
function stampLabel(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || !/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const date = new Date(parsed);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Seed the unified annotation list from any legacy notes/highlights on the book. */
function seedAnnotations(book: LibraryItem): Annotation[] {
  if (book.annotations?.length) return book.annotations;
  const seeded: Annotation[] = [];
  book.highlights?.forEach((hl, index) =>
    seeded.push({
      id: hl.id || `seed-hl-${index}`,
      kind: "highlight",
      page: hl.page,
      paragraph: 0,
      anchorText: hl.text,
      color: toAnnotationColor(hl.color),
      createdAt: "Earlier",
    }),
  );
  book.notes?.forEach((note, index) =>
    seeded.push({
      id: note.id || `seed-nt-${index}`,
      kind: "note",
      page: note.page,
      paragraph: 0,
      anchorText: note.text,
      body: note.text,
      color: "lavender",
      createdAt: note.createdAt,
    }),
  );
  return seeded;
}

export function MyProDarkReader({
  book,
  isOpen,
  onClose,
  onSaveProgress,
  colorMode = false,
}: MyProDarkReaderProps) {
  // Real PDF text (Roadmap Phase 10). Extraction runs on whichever device
  // holds the file; every other device reads the JSON it produced. The sample
  // pages below are the fallback for items with no PDF attached at all.
  const { source: pdfText, revision: pdfRevision } = usePdfText(book, isOpen);
  const pdfStatus = pdfText?.status ?? "unavailable";
  const hasPdfText = pdfStatus !== "unavailable";
  const totalPages = pdfText?.pageCount || book.totalPages || 1;
  // Page 1, not 128. The old default opened a book you had never read in the
  // middle, while `flowStart` below still began at 1 — so the crumb and the
  // page you were looking at disagreed until the first scroll corrected it.
  const [currentPage, setCurrentPage] = useState<number>(book.currentPage || 1);
  /** This device's reading preferences, restored from the last session. */
  const [prefs] = useState<ReaderPrefs>(readPrefs);
  const [theme, setTheme] = useState<ReaderTheme>(prefs.theme);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  // The panel slides over the page at every width now, so it starts closed —
  // reading is the default state of a reader.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<
    "toc" | "thumbnails" | "bookmarks" | "annotations"
  >("toc");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  /** Which hit of {@link searchHits} is showing. */
  const [searchIndex, setSearchIndex] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [fontSize, setFontSize] = useState<number>(prefs.fontSize);
  const [lineSpacing, setLineSpacing] = useState<number>(prefs.lineSpacing);
  const [readingWidth, setReadingWidth] = useState<number>(prefs.readingWidth);
  // Optional lined-paper backdrop (Samsung/Apple Notes style), spaced to the
  // current line height so rules sit behind each line of text.
  const [ruledPage, setRuledPage] = useState<boolean>(prefs.ruledPage);
  // Continuous is the default: one column you scroll top to bottom, pages
  // loading in as you reach them. Paged mode is still a setting.
  const [readingMode, setReadingMode] = useState<ReadingMode>(prefs.readingMode);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** What is being typed in the page box, until Enter or blur commits it. */
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  /** First page shown in the thumbnails panel (24 at a time). */
  const [thumbStart, setThumbStart] = useState(1);

  // Never seed demo bookmarks: `readerSync.flush` treats anything not loaded
  // from the server as new, so these two were *created* against whichever book
  // you opened without any.
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(book.bookmarks ?? []);
  const [annotations, setAnnotations] = useState<Annotation[]>(() => seedAnnotations(book));

  // Active text selection → drives the floating contextual toolbar.
  const [selection, setSelection] = useState<{
    text: string;
    page: number;
    paragraph: number;
    x: number;
    y: number;
  } | null>(null);
  const [highlightPicker, setHighlightPicker] = useState(false);

  // Open annotation editor (compact popover / mobile bottom-sheet).
  const [editor, setEditor] = useState<{
    id?: string;
    kind: AnnotationKind;
    page: number;
    paragraph: number;
    anchorText: string;
    title: string;
    body: string;
    tags: string;
  } | null>(null);

  // The continuous column runs from `flowStart` to `flowEnd`; the end grows as
  // you approach the bottom, and jumping (TOC, scrubber, page box) restarts
  // the flow at that page rather than rendering a whole book at once.
  const [flowStart, setFlowStart] = useState<number>(book.currentPage || 1);
  const [flowEnd, setFlowEnd] = useState<number>((book.currentPage || 1) + 3);
  const canvasRef = useRef<HTMLDivElement>(null);
  const bottomSentinel = useRef<HTMLDivElement>(null);
  /** Set while we scroll the canvas ourselves, so the observer stays quiet. */
  const programmaticScroll = useRef(false);

  /**
   * The dock gets out of the way while you read.
   *
   * It floats over the column, so on a phone it sat on top of whatever line
   * happened to be at the bottom of the screen. Reading downward hides it;
   * pausing, or scrolling back up, brings it straight back — the same bargain
   * Books and Readwise make, and the reason the page feels taller than it is.
   */
  const [dockHidden, setDockHidden] = useState(false);
  const lastScrollTop = useRef(0);
  const dockIdle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Bound to the canvas itself rather than attached in an effect: the canvas
   * only exists once the book's text has arrived, so an effect that ran on
   * mount found `canvasRef.current` empty and never listened to anything.
   */
  const onCanvasScroll = (event: React.UIEvent<HTMLElement>) => {
    const top = event.currentTarget.scrollTop;
    const delta = top - lastScrollTop.current;
    lastScrollTop.current = top;
    // Ignore the jitter of a finger resting on the glass.
    if (Math.abs(delta) > 6) setDockHidden(delta > 0 && top > 80);
    clearTimeout(dockIdle.current);
    dockIdle.current = setTimeout(() => setDockHidden(false), 900);
  };

  useEffect(() => () => clearTimeout(dockIdle.current), []);

  const [activeMarker, setActiveMarker] = useState<string | null>(null);
  const [emphasis, setEmphasis] = useState<string | null>(null);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);

  const [annFilter, setAnnFilter] = useState<AnnFilter>("All");
  const [annSort, setAnnSort] = useState<AnnSort>("page");
  const [annSearch, setAnnSearch] = useState("");

  const [toastMessage, setToastMessage] = useState("");
  const readerContainerRef = useRef<HTMLDivElement>(null);
  const paraRefs = useRef<Map<string, HTMLElement>>(new Map());

  const isNarrow = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;

  useEffect(() => {
    if (book.currentPage) setCurrentPage(book.currentPage);
  }, [book.currentPage]);

  // Robust selection detection — a selectionchange listener works for native
  // mobile long-press selection and handle-dragging, not just mouse-up.
  useEffect(() => {
    if (!isOpen) return;
    let raf = 0;
    const onSelectionChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (editor) return;
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || sel.isCollapsed || !text) {
          setSelection(null);
          return;
        }
        const range = sel.getRangeAt(0);
        const start =
          range.startContainer.nodeType === 3
            ? range.startContainer.parentElement
            : (range.startContainer as Element);
        const paraEl = start?.closest<HTMLElement>("[data-para]");
        if (!paraEl) {
          setSelection(null);
          return;
        }
        const rect = range.getBoundingClientRect();
        setHighlightPicker(false);
        setSelection({
          text,
          page: Number(paraEl.dataset.page),
          paragraph: Number(paraEl.dataset.para),
          x: rect.left + rect.width / 2,
          y: rect.top,
        });
      });
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      cancelAnimationFrame(raf);
    };
  }, [isOpen, editor]);

  // Auto-save: derive legacy notes/highlights so existing views keep working,
  // and persist the full annotation list alongside them.
  useEffect(() => {
    if (!isOpen) return;
    const derivedNotes: NoteItem[] = annotations
      .filter((a) => a.kind === "note")
      .map((a) => ({ id: a.id, page: a.page, text: a.body || a.anchorText, createdAt: a.createdAt }));
    const derivedHighlights: HighlightItem[] = annotations
      .filter((a) => a.kind === "highlight")
      .map((a) => ({ id: a.id, page: a.page, text: a.anchorText, color: toHighlightColor(a.color) }));
    onSaveProgress(
      book.title,
      currentPage,
      totalPages,
      bookmarks,
      derivedNotes,
      derivedHighlights,
      annotations,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, bookmarks, annotations, isOpen]);

  const toastTimer = useRef<number | undefined>(undefined);
  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(""), 2200);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // ----- Page content -----
  /** The PDF's own outline when it has one, else the item's, else the sample. */
  const tocEntries = useMemo<TocChapter[]>(() => {
    const fromPdf = pdfText?.toc ?? [];
    if (fromPdf.length) return fromPdf;
    return book.toc || creativeActToc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfText, pdfRevision, book.toc]);

  const getPageContent = useCallback(
    (page: number): BookPageContent => {
      if (hasPdfText) {
        const chapter = chapterAt(tocEntries, page);
        const extracted = pdfText?.page(page);
        return {
          pageNumber: page,
          // A heading found on the page itself beats the outline's guess.
          chapterTitle: extracted?.heading || chapter?.title || book.title,
          partTitle: chapter?.part,
          blocks: extracted?.blocks,
          runningHead: extracted?.runningHead,
          // Empty until this page is extracted; the sheet shows the state.
          paragraphs: extracted?.paragraphs ?? [],
        };
      }
      if (sampleBookPages[page]) return sampleBookPages[page];
      const chapterNum = Math.floor(page / 15) + 1;
      return {
        pageNumber: page,
        chapterTitle: `Chapter ${chapterNum} · Reflections on Form`,
        partTitle: page < 100 ? "Part I: Looking" : "Part II: Crafting",
        paragraphs: [
          `The practice of art requires daily devotion to simple observation. On page ${page}, consider how the structure of your day shapes the nature of your thoughts.`,
          "When we create from a place of unhurried presence, our instincts speak louder than our anxieties. There is no urgency in nature: the tree does not hurry to blossom, yet the flower appears on schedule.",
          "Take a moment to absorb this chapter’s essence before turning the page. Your notes, highlights, and markers in the sidebar help you revisit these reflections later.",
        ],
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasPdfText, pdfText, pdfRevision, tocEntries, book.title],
  );

  // Extract the page being read (and the next couple) on demand.
  useEffect(() => {
    if (!pdfText) return;
    void pdfText.ensure(currentPage);
  }, [pdfText, currentPage]);

  // A remembered page (or the sample default) can sit past the real last page
  // once the PDF tells us how long it actually is.
  useEffect(() => {
    const count = pdfText?.pageCount ?? 0;
    if (count && currentPage > count) setCurrentPage(count);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfText, pdfRevision, currentPage]);

  const chapterForPage = useCallback(
    (page: number) => {
      const toc = tocEntries;
      const found = [...toc].reverse().find((item) => page >= item.page);
      return found ? found.title : getPageContent(page).chapterTitle;
    },
    [tocEntries, getPageContent],
  );

  const pageContent = useMemo(
    () => getPageContent(currentPage),
    [currentPage, getPageContent],
  );
  const currentChapter = useMemo(() => chapterForPage(currentPage), [currentPage, chapterForPage]);
  const progressPercent = totalPages
    ? Math.min(100, Math.round((currentPage / totalPages) * 100))
    : 0;

  /**
   * Zoom used to be a `scale()` on the page wrapper, which only applies in
   * paginated mode — so in continuous mode (the default) the buttons moved a
   * percentage and nothing else. Scaling the type instead works in both, and
   * leaves the scroll height honest for the page observers.
   */
  const sheetFontSize =
    readingMode === "continuous" ? (fontSize * zoomLevel) / 100 : fontSize;

  // Pages in the canvas: one when paged, the loaded flow when continuous.
  const visiblePages = useMemo(() => {
    if (readingMode === "paginated") return [currentPage];
    const pages: number[] = [];
    for (let p = Math.max(1, flowStart); p <= Math.min(totalPages, flowEnd); p++) pages.push(p);
    return pages.length ? pages : [1];
  }, [readingMode, currentPage, flowStart, flowEnd, totalPages]);

  /** Restart the continuous column at `page` (a jump, not a scroll). */
  const flowTo = useCallback(
    (page: number) => {
      const target = Math.min(Math.max(1, page), totalPages);
      setCurrentPage(target);
      if (readingMode !== "continuous") return;
      setFlowStart(target);
      setFlowEnd(target + 3);
      programmaticScroll.current = true;
      requestAnimationFrame(() => {
        canvasRef.current?.scrollTo({ top: 0 });
        // Let the scroll settle before the observer is trusted again.
        setTimeout(() => {
          programmaticScroll.current = false;
        }, 300);
      });
    },
    [readingMode, totalPages],
  );

  // Keyboard navigation (disabled while typing or editing an annotation).
  // Declared after `flowTo` because it depends on it.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        editor
      ) {
        if (e.key === "Escape" && editor) setEditor(null);
        return;
      }
      // `setCurrentPage` alone only moved the label in continuous mode — and
      // the scroll observer then put it straight back. `flowTo` actually
      // turns the page in both modes.
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        flowTo(Math.min(totalPages, currentPage + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        flowTo(Math.max(1, currentPage - 1));
      } else if (e.key === "Escape") {
        if (moreOpen) setMoreOpen(false);
        else if (isSettingsOpen) setIsSettingsOpen(false);
        else if (isSearching) setIsSearching(false);
        else if (activeMarker) setActiveMarker(null);
        else if (selection) setSelection(null);
        else if (isNarrow() && isSidebarOpen) setIsSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    totalPages,
    currentPage,
    flowTo,
    isSettingsOpen,
    isSearching,
    activeMarker,
    selection,
    editor,
    moreOpen,
    isSidebarOpen,
  ]);

  /** Prepend a few pages, holding your place: growing upward moves the
   *  content under you, so the scroll position is compensated by hand. */
  const loadEarlier = useCallback(() => {
    const root = canvasRef.current;
    const before = root?.scrollHeight ?? 0;
    const scrollTop = root?.scrollTop ?? 0;
    setFlowStart((start) => Math.max(1, start - 4));
    requestAnimationFrame(() => {
      if (!root) return;
      root.scrollTop = scrollTop + (root.scrollHeight - before);
    });
  }, []);

  /**
   * Switching into the scrolling column anchors it on the page you were
   * reading.
   *
   * This used to keep the old `flowStart` whenever the current page happened
   * to fall inside the loaded range — so paging forward to 208 in paged mode
   * and switching back put you at the top of the column at 205, three pages
   * behind where you actually were. The column now always begins at the page
   * you are on.
   */
  useEffect(() => {
    if (readingMode !== "continuous") return;
    setFlowStart(currentPage);
    setFlowEnd(currentPage + 3);
    programmaticScroll.current = true;
    requestAnimationFrame(() => {
      canvasRef.current?.scrollTo({ top: 0 });
      setTimeout(() => {
        programmaticScroll.current = false;
      }, 300);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readingMode]);

  // Remember how this device likes to read, for the next book and the next
  // session.
  useEffect(() => {
    writePrefs({ theme, fontSize, lineSpacing, readingWidth, ruledPage, readingMode });
  }, [theme, fontSize, lineSpacing, readingWidth, ruledPage, readingMode]);

  // A half-typed page number must not outlive the page it was typed against:
  // jumping by the scrubber or the contents left the box showing a number
  // that had nothing to do with what was on screen.
  useEffect(() => {
    setPageDraft(null);
  }, [currentPage]);

  // Load the next pages as the bottom of the column comes into view.
  useEffect(() => {
    if (!isOpen || readingMode !== "continuous") return;
    const sentinel = bottomSentinel.current;
    const root = canvasRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setFlowEnd((end) => (end >= totalPages ? end : Math.min(totalPages, end + 4)));
      },
      { root, rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isOpen, readingMode, totalPages, flowEnd]);

  // Which page you are actually looking at, so the dock, chapter crumb and
  // progress follow the scroll rather than lagging behind it.
  useEffect(() => {
    if (!isOpen || readingMode !== "continuous") return;
    const root = canvasRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (programmaticScroll.current) return;
        const top = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const page = Number((top?.target as HTMLElement | undefined)?.dataset.sheetPage);
        if (page) setCurrentPage(page);
      },
      { root, threshold: [0.1, 0.5], rootMargin: "-20% 0px -60% 0px" },
    );
    root.querySelectorAll<HTMLElement>("[data-sheet-page]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [isOpen, readingMode, visiblePages.length]);

  // ----- Bookmarks -----
  const isCurrentPageBookmarked = bookmarks.some((b) => b.page === currentPage);
  const toggleBookmark = () => {
    if (isCurrentPageBookmarked) {
      setBookmarks((cur) => cur.filter((b) => b.page !== currentPage));
      triggerToast(`Removed bookmark for page ${currentPage}`);
    } else {
      setBookmarks((cur) => [
        ...cur,
        {
          id: `bm-${Date.now()}`,
          page: currentPage,
          title: chapterForPage(currentPage) || `Page ${currentPage}`,
          createdAt: "Just now",
        },
      ]);
      triggerToast(`Page ${currentPage} bookmarked`);
    }
  };
  const removeBookmark = (id: string) => {
    setBookmarks((cur) => cur.filter((b) => b.id !== id));
    triggerToast("Bookmark removed");
  };

  // ----- Annotation CRUD -----
  const createAnnotation = (
    partial: Pick<Annotation, "kind" | "page" | "paragraph" | "anchorText"> &
      Partial<Annotation>,
  ) => {
    const ann: Annotation = {
      id: `ann-${Date.now()}`,
      color: ANNOTATION_META[partial.kind].color,
      chapter: chapterForPage(partial.page),
      createdAt: "Just now",
      ...partial,
    };
    setAnnotations((cur) => [ann, ...cur]);
    return ann;
  };

  const updateAnnotation = (id: string, patch: Partial<Annotation>) =>
    setAnnotations((cur) => cur.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const deleteAnnotation = (id: string) => {
    setAnnotations((cur) => cur.filter((a) => a.id !== id));
    if (activeMarker === id) setActiveMarker(null);
    triggerToast("Annotation deleted");
  };

  const openEditor = (kind: AnnotationKind) => {
    if (!selection) return;
    setEditor({
      kind,
      page: selection.page,
      paragraph: selection.paragraph,
      anchorText: selection.text,
      title: "",
      body: "",
      tags: "",
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  const openEditExisting = (a: Annotation) => {
    setActiveMarker(null);
    setEditor({
      id: a.id,
      kind: a.kind,
      page: a.page,
      paragraph: a.paragraph,
      anchorText: a.anchorText,
      title: a.title || "",
      body: a.body || "",
      tags: (a.tags || []).join(", "),
    });
  };

  const saveEditor = () => {
    if (!editor) return;
    const tags = editor.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (editor.id) {
      updateAnnotation(editor.id, { title: editor.title, body: editor.body, tags });
      triggerToast(`${ANNOTATION_META[editor.kind].label} updated`);
    } else {
      createAnnotation({
        kind: editor.kind,
        page: editor.page,
        paragraph: editor.paragraph,
        anchorText: editor.anchorText,
        title: editor.title || undefined,
        body: editor.body || undefined,
        tags,
      });
      triggerToast(`${ANNOTATION_META[editor.kind].label} saved to page ${editor.page}`);
    }
    setEditor(null);
  };

  const applyHighlight = (color: AnnotationColor) => {
    if (!selection) return;
    createAnnotation({
      kind: "highlight",
      page: selection.page,
      paragraph: selection.paragraph,
      anchorText: selection.text,
      color,
    });
    triggerToast("Passage highlighted");
    setSelection(null);
    setHighlightPicker(false);
    window.getSelection()?.removeAllRanges();
  };

  const copyQuote = (a: Annotation) => {
    navigator.clipboard?.writeText(`“${a.anchorText}” — ${book.title}, p.${a.page}`).catch(() => {});
    triggerToast("Quote copied");
  };

  // ----- Jump to an annotation's original passage -----
  const jumpToAnnotation = (a: Annotation) => {
    setActiveMarker(a.id);
    // Either mode needs the page actually rendered before we can scroll to it.
    const loaded = readingMode === "continuous" && a.page >= flowStart && a.page <= flowEnd;
    if (a.page !== currentPage && !loaded) flowTo(a.page);
    setPendingScroll(`${a.page}|${a.paragraph}|${a.id}`);
    if (isNarrow()) setIsSidebarOpen(false);
  };

  useEffect(() => {
    if (!pendingScroll) return;
    const [page, para, id] = pendingScroll.split("|");
    let attempts = 0;
    let timer = 0;
    // The target page may still be loading into the flow, so look for the
    // paragraph a few times before giving up rather than once at 120ms.
    const run = () => {
      const el = paraRefs.current.get(`${page}-${para}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setEmphasis(`${page}-${para}`);
        setTimeout(() => setEmphasis(null), 1700);
      } else if (attempts < 8) {
        attempts += 1;
        timer = window.setTimeout(run, 120);
        return;
      }
      // A search jump carries no annotation id; don't clear the current one.
      if (id) setActiveMarker(id);
      setPendingScroll(null);
    };
    timer = window.setTimeout(run, 120);
    return () => window.clearTimeout(timer);
  }, [pendingScroll]);

  const toggleFullscreen = () => {
    if (!readerContainerRef.current) return;
    if (!document.fullscreenElement) {
      readerContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // ----- Derived annotation list for the sidebar -----
  const sidebarEntries = useMemo(() => {
    let list = annotations.slice();
    if (annFilter !== "All" && annFilter !== "bookmark") {
      list = list.filter((a) => a.kind === annFilter);
    }
    if (annSearch.trim()) {
      const q = annSearch.toLowerCase();
      list = list.filter((a) =>
        `${a.title ?? ""} ${a.body ?? ""} ${a.anchorText} ${(a.tags || []).join(" ")}`
          .toLowerCase()
          .includes(q),
      );
    }
    if (annSort === "page") list.sort((a, b) => a.page - b.page);
    else if (annSort === "type") list.sort((a, b) => a.kind.localeCompare(b.kind));
    // "Recently created" was offered in the select and never implemented, so
    // it silently showed whatever order the server happened to return.
    else if (annSort === "recent") list.sort((a, b) => recencyOf(b) - recencyOf(a));
    return list;
  }, [annotations, annFilter, annSearch, annSort]);

  const activeAnnotation = annotations.find((a) => a.id === activeMarker) || null;

  /* ----- Document search -------------------------------------------------
   * This was a text field next to a hardcoded "3 matches": typing did
   * nothing. It now searches the pages whose text has been extracted — all
   * of them once extraction finishes, and the loaded ones before that —
   * which is the only text the device actually holds.
   * -------------------------------------------------------------------- */
  const searchHits = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle.length < 2) return [] as { page: number; paragraph: number; excerpt: string }[];
    const hits: { page: number; paragraph: number; excerpt: string }[] = [];
    for (let page = 1; page <= totalPages && hits.length < SEARCH_LIMIT; page++) {
      const paragraphs = getPageContent(page).paragraphs;
      paragraphs.forEach((text, paragraph) => {
        const at = text.toLowerCase().indexOf(needle);
        if (at === -1) return;
        hits.push({
          page,
          paragraph,
          excerpt: `${at > 24 ? "…" : ""}${text.slice(Math.max(0, at - 24), at + needle.length + 40)}…`,
        });
      });
    }
    return hits;
  }, [searchQuery, totalPages, getPageContent]);

  const goToHit = (index: number) => {
    const hit = searchHits[index];
    if (!hit) return;
    setSearchIndex(index);
    const loaded =
      readingMode === "continuous" && hit.page >= flowStart && hit.page <= flowEnd;
    if (hit.page !== currentPage && !loaded) flowTo(hit.page);
    setPendingScroll(`${hit.page}|${hit.paragraph}|`);
  };

  if (!isOpen) return null;

  // Highlight the matching run of a paragraph's text with any highlight annotations.
  const renderParagraphContent = (text: string, page: number, para: number, isFirst: boolean) => {
    const hls = annotations.filter(
      (a) => a.kind === "highlight" && a.page === page && a.paragraph === para,
    );
    if (hls.length === 0) {
      if (isFirst) {
        return (
          <>
            <span className="drop-cap">{text.charAt(0)}</span>
            {text.slice(1)}
          </>
        );
      }
      return text;
    }
    // Build non-overlapping segments for each highlight found.
    const segments: { text: string; color?: AnnotationColor }[] = [{ text }];
    for (const hl of hls) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.color) continue;
        const idx = seg.text.indexOf(hl.anchorText);
        if (idx === -1) continue;
        const before = seg.text.slice(0, idx);
        const match = seg.text.slice(idx, idx + hl.anchorText.length);
        const after = seg.text.slice(idx + hl.anchorText.length);
        const replacement = [
          ...(before ? [{ text: before }] : []),
          { text: match, color: hl.color },
          ...(after ? [{ text: after }] : []),
        ];
        segments.splice(i, 1, ...replacement);
        break;
      }
    }
    return segments.map((seg, i) =>
      seg.color ? (
        <mark key={i} className={`reader-highlight hl-${seg.color}`}>
          {seg.text}
        </mark>
      ) : (
        <span key={i}>{seg.text}</span>
      ),
    );
  };

  /** One body paragraph, with its annotation markers. Shared by the block
   *  renderer (real PDFs) and the flat renderer (sample pages). */
  const renderParagraph = (
    page: number,
    pText: string,
    idx: number,
    content: BookPageContent,
  ) => {
const key = `${page}-${idx}`;
    const paraAnns = annotations.filter((a) => a.page === page && a.paragraph === idx);
    return (
      <div
        className={`sheet-para-row ${emphasis === key ? "emphasized" : ""}`}
        key={key}
      >
        <p
          className="sheet-body-text"
          data-page={page}
          data-para={idx}
          ref={(el) => {
            if (el) paraRefs.current.set(key, el);
            else paraRefs.current.delete(key);
          }}
        >
          {renderParagraphContent(pText, page, idx, idx === 0 && !content.quote)}
        </p>
        {paraAnns.length > 0 && (
          <div className="para-marker-gutter" aria-hidden={false}>
            {paraAnns.map((a, markerIndex) => {
              const meta = ANNOTATION_META[a.kind];
              return (
                <button
                  type="button"
                  key={a.id}
                  className={`annotation-marker marker-${a.color || meta.color} ${
                    activeMarker === a.id ? "active" : ""
                  }`}
                  style={{ marginTop: markerIndex === 0 ? 0 : -4 }}
                  title={`${meta.label} · page ${a.page}`}
                  onClick={() => {
                    setActiveMarker(a.id);
                    setEmphasis(key);
                    setTimeout(() => setEmphasis(null), 1700);
                  }}
                  aria-label={`${meta.label} marker on page ${a.page}`}
                >
                  <meta.Icon size={11} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  /** What to say on a page whose text is not there (yet, or at all). */
  const pageStatusMessage = (page: number): string => {
    if (pdfStatus === "error") {
      return pdfText?.error || "This PDF could not be read on this device.";
    }
    if (pdfStatus === "scanned") {
      return "This PDF has no text in it, and reading it as an image found none either — it may be photographs or a blank scan.";
    }
    if (pdfStatus === "ocr") {
      // Recognition runs front to back and saves as it goes, so saying which
      // page is being read is the difference between "working" and "stuck".
      return `No text layer in this PDF, so MyPro is reading the scan itself. Page ${page} is still to come.`;
    }
    if (pdfStatus === "loading") return "Opening the PDF…";
    if (pdfText?.page(page)?.empty) return "This page has no text (it may be an image or a blank page).";
    return `Extracting page ${page}…`;
  };

  /** The toolbar's one-line account of what extraction is doing. */
  const extractionNote = (): string | null => {
    if (!hasPdfText) return null;
    if (pdfStatus === "loading") return "Opening PDF…";
    if (pdfStatus === "extracting") {
      const count = pdfText?.extracted ?? 0;
      const total = pdfText?.pageCount ?? 0;
      return total ? `Extracting text · ${count}/${total}` : "Extracting text…";
    }
    if (pdfStatus === "ocr") {
      const count = pdfText?.extracted ?? 0;
      const total = pdfText?.pageCount ?? 0;
      // Slow enough — seconds a page, not milliseconds — that a count is the
      // only honest way to show it is progressing.
      return total ? `Reading the scan · ${count}/${total}` : "Reading the scan…";
    }
    if (pdfStatus === "scanned") return "Scanned PDF · no readable text";
    if (pdfStatus === "error") return "PDF unreadable";
    return null;
  };

  const renderSheet = (page: number) => {
    const content = getPageContent(page);
    // Scrolling through a chapter should not re-announce it on every page;
    // the heading appears where the chapter actually changes — and always on
    // the first sheet of the column, which has no page above it to have
    // announced the chapter. Without that, opening a book mid-chapter showed
    // a wall of paragraphs with nothing saying what you were reading.
    const previous = page > 1 ? getPageContent(page - 1) : null;
    const isFirstLoaded = page === visiblePages[0];
    const showHeading =
      readingMode === "paginated" ||
      isFirstLoaded ||
      !previous ||
      previous.chapterTitle !== content.chapterTitle;
    return (
      <article
        key={page}
        data-sheet-page={page}
        className={`reader-page-sheet ${theme}`}
        style={
          {
            fontSize: `${sheetFontSize.toFixed(2)}px`,
            lineHeight: lineSpacing,
            "--rule-step": `${(sheetFontSize * lineSpacing).toFixed(2)}px`,
          } as React.CSSProperties
        }
      >
        <div className="sheet-top-meta">
          <span className="sheet-book-name">{book.title}</span>
          <span className="sheet-part-name">
            {content.partTitle || (hasPdfText ? "" : "Part III: Crafting")}
          </span>
          <span className="sheet-page-marker">{page}</span>
        </div>

        {showHeading && (
          <header className="sheet-heading">
            <h2>{content.chapterTitle}</h2>
            <div className="sheet-divider" />
          </header>
        )}

        {content.quote && (
          <blockquote className="sheet-quote-callout">
            <p>“{content.quote}”</p>
            {content.quoteAuthor && <cite>— {content.quoteAuthor}</cite>}
          </blockquote>
        )}

        {hasPdfText && content.paragraphs.length === 0 && (
          <div className="sheet-text-status" role="status">
            <span className="sheet-text-status-dot" aria-hidden="true" />
            <span>{pageStatusMessage(page)}</span>
          </div>
        )}

        {content.blocks?.length ? (
          <div className="sheet-paragraphs">
            {(() => {
              // Paragraph indices must stay aligned with `paragraphs`, since
              // annotations are anchored to that index.
              let paragraphIndex = -1;
              return content.blocks.map((block, blockIndex) => {
                if (block.kind === "heading" || block.kind === "subheading") {
                  const Tag = block.level === 1 ? "h3" : "h4";
                  return (
                    <Tag className={`sheet-block-${block.kind}`} key={`b-${blockIndex}`}>
                      {block.text}
                    </Tag>
                  );
                }
                if (block.kind === "caption") {
                  return (
                    <p className="sheet-block-caption" key={`b-${blockIndex}`}>
                      {block.text}
                    </p>
                  );
                }
                paragraphIndex += 1;
                return renderParagraph(page, block.text, paragraphIndex, content);
              });
            })()}
          </div>
        ) : (
        <div className="sheet-paragraphs">
          {content.paragraphs.map((pText, idx) => renderParagraph(page, pText, idx, content))}
        </div>
        )}

        {content.diagram && (
          <div className="sheet-diagram-container">
            <div className="natural-diagram-frame">
              <svg viewBox="0 0 400 180" className="diagram-svg" aria-label={content.diagram.title}>
                <circle cx="120" cy="90" r="60" fill="rgba(182, 154, 245, 0.12)" stroke="#b69af5" strokeWidth="1.5" strokeDasharray="4 4" />
                <circle cx="280" cy="90" r="60" fill="rgba(112, 220, 229, 0.12)" stroke="#70dce5" strokeWidth="1.5" />
                <circle cx="200" cy="90" r="35" fill="rgba(255, 255, 255, 0.08)" stroke="#ffffff" strokeWidth="1.5" />
                <text x="120" y="95" textAnchor="middle" fill="#b69af5" fontSize="12" fontFamily="DM Sans">Observation</text>
                <text x="280" y="95" textAnchor="middle" fill="#70dce5" fontSize="12" fontFamily="DM Sans">Execution</text>
                <text x="200" y="95" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="600" fontFamily="DM Sans">Presence</text>
              </svg>
            </div>
            <span className="diagram-caption">
              <strong>Figure 18.1: {content.diagram.title}</strong> — {content.diagram.caption}
            </span>
          </div>
        )}

        <div className="sheet-bottom-meta">
          <span>MyPro Reading Environment</span>
          <span>Page {page} of {totalPages}</span>
        </div>
      </article>
    );
  };

  return (
    <div
      ref={readerContainerRef}
      className={`mypro-dark-reader ${theme}-theme ${colorMode ? "color-mode" : ""} mode-${readingMode} ${ruledPage ? "ruled" : ""}`}
    >
      {/* ================= TOP TOOLBAR ================= */}
      <header className="reader-top-toolbar">
        <div className="toolbar-left">
          <button type="button" className="reader-back-button" onClick={onClose} aria-label="Back to Library">
            <ArrowLeft size={16} />
            <span>Library</span>
          </button>
          <div className="reader-title-group">
            <span className="reader-book-title">{book.title}</span>
            <span className="reader-crumb-separator">/</span>
            <span className="reader-chapter-title">{currentChapter}</span>
          </div>
          {extractionNote() && (
            <span
              className={`reader-pdf-status ${
                pdfStatus === "error" || pdfStatus === "scanned" ? "warn" : ""
              }`}
              role="status"
            >
              {extractionNote()}
            </span>
          )}
        </div>

        <div className="toolbar-center">
          {isSearching ? (
            <div className="reader-inline-search">
              <Search size={15} />
              <input
                autoFocus
                placeholder="Search words in document..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setIsSearching(false);
                  if (e.key === "Enter" && searchHits.length) {
                    e.preventDefault();
                    goToHit(
                      e.shiftKey
                        ? (searchIndex - 1 + searchHits.length) % searchHits.length
                        : searchHits.length === 1 || !searchHits[searchIndex]
                          ? 0
                          : (searchIndex + 1) % searchHits.length,
                    );
                  }
                }}
              />
              {searchQuery.trim().length >= 2 && (
                <span className="match-count">
                  {searchHits.length === 0
                    ? "No matches"
                    : `${Math.min(searchIndex + 1, searchHits.length)} of ${searchHits.length}${
                        searchHits.length >= SEARCH_LIMIT ? "+" : ""
                      }`}
                </span>
              )}
              {searchHits.length > 1 && (
                <>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Previous match"
                    onClick={() =>
                      goToHit((searchIndex - 1 + searchHits.length) % searchHits.length)
                    }
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Next match"
                    onClick={() => goToHit((searchIndex + 1) % searchHits.length)}
                  >
                    <ChevronRight size={14} />
                  </button>
                </>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label="Close search"
                onClick={() => setIsSearching(false)}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button type="button" className="toolbar-pill-button" onClick={() => setIsSearching(true)} title="Search Document">
              <Search size={14} />
              <span>Search</span>
            </button>
          )}
        </div>

        <div className="toolbar-right">
          <button
            type="button"
            className={`toolbar-icon-button ${isSidebarOpen ? "active" : ""}`}
            onClick={() => setIsSidebarOpen((v) => !v)}
            title="Toggle Sidebar"
          >
            <List size={17} />
          </button>
          <button
            type="button"
            className={`toolbar-icon-button reader-hide-mobile ${isCurrentPageBookmarked ? "bookmarked" : ""}`}
            onClick={toggleBookmark}
            title={isCurrentPageBookmarked ? "Remove Bookmark" : "Bookmark this page"}
          >
            {isCurrentPageBookmarked ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
          </button>

          <div className="settings-popover-anchor">
            <button
              type="button"
              className={`toolbar-icon-button reader-hide-mobile ${isSettingsOpen ? "active" : ""}`}
              onClick={() => setIsSettingsOpen((v) => !v)}
              title="Reading Settings"
            >
              <SlidersHorizontal size={17} />
            </button>

            {/*
              Portalled to <body> on purpose.

              The toolbar carries `backdrop-filter`, and a filtered element
              becomes the containing block for any `position: fixed`
              descendant — which pinned this sheet to the toolbar's own 52px
              box, so on a phone it opened above the top of the screen. Taking
              it out of the toolbar lets the bar keep its glass and lets the
              sheet belong to the viewport, which is what both of its layouts
              assume.
            */}
            {isSettingsOpen && createPortal(
              /*
                The wrapper repeats the reader's own classes so the sheet's
                `.mypro-dark-reader …` rules keep matching outside the reader
                subtree, and `display: contents` keeps it out of layout so it
                adds no box of its own.
              */
              <div
                className={`mypro-dark-reader ${theme}-theme ${
                  colorMode ? "color-mode" : ""
                } mode-${readingMode}`}
                style={{ display: "contents" }}
              >
                <div
                  className="reader-settings-backdrop"
                  onClick={() => setIsSettingsOpen(false)}
                />
                <div className="reading-settings-menu glass-card" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="settings-sheet-handle" aria-hidden="true" />
                  <div className="settings-menu-header">
                  <span className="section-kicker">READING ENVIRONMENT</span>
                  <h4>Display & Theme</h4>
                </div>

                <div className="setting-section">
                  <span className="setting-label">READING MODE</span>
                  <div className="reader-segmented">
                    <button className={readingMode === "paginated" ? "active" : ""} onClick={() => setReadingMode("paginated")}>
                      <BookOpen size={13} /> Paginated
                    </button>
                    <button className={readingMode === "continuous" ? "active" : ""} onClick={() => setReadingMode("continuous")}>
                      <AlignLeft size={13} /> Continuous
                    </button>
                  </div>
                </div>

                <div className="setting-section">
                  <span className="setting-label">BACKGROUND THEME</span>
                  <div className="theme-toggle-row">
                    {(["dark", "sepia", "original"] as ReaderTheme[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`theme-option ${t}-btn ${theme === t ? "active" : ""}`}
                        onClick={() => setTheme(t)}
                      >
                        <div className={`theme-swatch ${t}`} />
                        <span>{t === "dark" ? "Dark" : t === "sepia" ? "Sepia" : "Paper"}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-section">
                  <span className="setting-label">FONT SIZE ({fontSize}px)</span>
                  <div className="font-size-row">
                    <button type="button" onClick={() => setFontSize((s) => Math.max(14, s - 1))}>A-</button>
                    <input type="range" min={14} max={22} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
                    <button type="button" onClick={() => setFontSize((s) => Math.min(22, s + 1))}>A+</button>
                  </div>
                </div>

                <div className="setting-section">
                  <span className="setting-label">
                    LINE SPACING ({lineSpacing.toFixed(2)}×)
                  </span>
                  <div className="reader-segmented">
                    {LINE_PRESETS.map(({ value, label }) => (
                      <button
                        key={value}
                        className={Math.abs(lineSpacing - value) < 0.001 ? "active" : ""}
                        onClick={() => setLineSpacing(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* The three presets are the quick answer; this is for
                      anyone who wants the gap exactly where they like it. */}
                  <div className="line-gap-row">
                    <AlignJustify size={13} aria-hidden="true" />
                    <input
                      type="range"
                      min={1.2}
                      max={2.4}
                      step={0.05}
                      value={lineSpacing}
                      aria-label="Line spacing"
                      onChange={(e) => setLineSpacing(Number(e.target.value))}
                    />
                    <span className="line-gap-value">{lineSpacing.toFixed(2)}×</span>
                  </div>
                </div>

                <div className="setting-section">
                  <span className="setting-label">READING WIDTH</span>
                  <div className="reader-segmented">
                    {[640, 720, 800].map((v) => (
                      <button key={v} className={readingWidth === v ? "active" : ""} onClick={() => setReadingWidth(v)}>
                        {v === 640 ? "Narrow" : v === 720 ? "Comfort" : "Wide"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-section">
                  <button
                    type="button"
                    className={`reader-toggle-row ${ruledPage ? "on" : ""}`}
                    role="switch"
                    aria-checked={ruledPage}
                    onClick={() => setRuledPage((v) => !v)}
                  >
                    <span className="reader-toggle-text">
                      <AlignJustify size={14} />
                      Ruled page
                    </span>
                    <span className="reader-toggle-switch" aria-hidden="true" />
                  </button>
                </div>

                  <div className="setting-note">
                    <Info size={13} />
                    <span>Markers stay anchored when the layout changes.</span>
                  </div>
                </div>
              </div>,
              document.body,
            )}
          </div>

          <button
            type="button"
            className="toolbar-icon-button reader-hide-mobile"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>

          {/* Mobile overflow: secondary controls move here so the header never overflows */}
          <div className="toolbar-more-anchor reader-only-mobile">
            <button
              type="button"
              className={`toolbar-icon-button ${moreOpen ? "active" : ""}`}
              onClick={() => setMoreOpen((v) => !v)}
              title="More options"
              aria-label="More options"
            >
              <MoreHorizontal size={18} />
            </button>
            {moreOpen && (
              <>
                <div className="reader-more-backdrop" onClick={() => setMoreOpen(false)} />
                <div className="reader-more-menu glass-card" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      toggleBookmark();
                      setMoreOpen(false);
                    }}
                  >
                    {isCurrentPageBookmarked ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                    <span>{isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark page"}</span>
                  </button>
                  <button
                    onClick={() => {
                      setMoreOpen(false);
                      setIsSettingsOpen(true);
                    }}
                  >
                    <SlidersHorizontal size={15} />
                    <span>Reading settings</span>
                  </button>
                  <button
                    onClick={() => {
                      toggleFullscreen();
                      setMoreOpen(false);
                    }}
                  >
                    {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    <span>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ================= READER BODY ================= */}
      <div className="reader-body">
        {isSidebarOpen && (
          <div className="reader-sidebar-backdrop" onClick={() => setIsSidebarOpen(false)} />
        )}
        <aside className={`reader-sidebar ${isSidebarOpen ? "open" : "collapsed"}`}>
          <div className="reader-sidebar-tabs">
            <button type="button" className={`sidebar-tab-btn ${sidebarTab === "toc" ? "active" : ""}`} onClick={() => setSidebarTab("toc")}>
              <List size={14} />
              <span>Contents</span>
            </button>
            <button
              type="button"
              className={`sidebar-tab-btn ${sidebarTab === "thumbnails" ? "active" : ""}`}
              onClick={() => {
                // Open on the page being read, not always at the front.
                setThumbStart(
                  Math.max(1, Math.min(Math.max(1, totalPages - 23), currentPage - 11)),
                );
                setSidebarTab("thumbnails");
              }}
            >
              <Layers size={14} />
              <span>Pages</span>
            </button>
            <button type="button" className={`sidebar-tab-btn ${sidebarTab === "bookmarks" ? "active" : ""}`} onClick={() => setSidebarTab("bookmarks")}>
              <Bookmark size={14} />
              <span>Marks</span>
            </button>
            <button type="button" className={`sidebar-tab-btn ${sidebarTab === "annotations" ? "active" : ""}`} onClick={() => setSidebarTab("annotations")}>
              <StickyNote size={14} />
              <span>Notes</span>
            </button>
          </div>

          <div className="reader-sidebar-scroll">
            {sidebarTab === "toc" && (
              <div className="toc-list">
                <span className="toc-heading">TABLE OF CONTENTS</span>
                {tocEntries.map((chap: TocChapter) => (
                  <button
                    type="button"
                    key={chap.id}
                    className={`toc-item ${currentPage === chap.page ? "current" : ""} ${currentPage >= chap.page ? "visited" : ""}`}
                    onClick={() => { flowTo(chap.page); if (isNarrow()) setIsSidebarOpen(false); }}
                  >
                    <div className="toc-item-info">
                      <strong>{chap.title}</strong>
                      {chap.preview && <p>{chap.preview}</p>}
                    </div>
                    <span className="toc-page-num">p. {chap.page}</span>
                  </button>
                ))}
              </div>
            )}

            {sidebarTab === "thumbnails" && (
              <div className="thumbnails-grid">
                {/* A window around where you are. Fixed at pages 1–24, this
                    panel could not reach page 25 of a 320-page book. */}
                {Array.from({ length: Math.min(24, totalPages) }, (_, i) => {
                  const pageNum = thumbStart + i;
                  return (
                    <button
                      type="button"
                      key={pageNum}
                      className={`thumbnail-card ${pageNum === currentPage ? "active" : ""}`}
                      onClick={() => { flowTo(pageNum); if (isNarrow()) setIsSidebarOpen(false); }}
                    >
                      <div className="thumbnail-paper">
                        <span className="thumb-lines" />
                        <span className="thumb-lines short" />
                      </div>
                      <span className="thumbnail-label">{pageNum}</span>
                    </button>
                  );
                })}
                {totalPages > 24 && (
                  <div className="thumbnails-pager">
                    <button
                      type="button"
                      onClick={() => setThumbStart((s) => Math.max(1, s - 24))}
                      disabled={thumbStart <= 1}
                    >
                      <ChevronLeft size={13} /> Earlier
                    </button>
                    <span>
                      {thumbStart}–{Math.min(totalPages, thumbStart + 23)} of {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setThumbStart((s) => Math.min(Math.max(1, totalPages - 23), s + 24))
                      }
                      disabled={thumbStart + 24 > totalPages}
                    >
                      Later <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {sidebarTab === "bookmarks" && (
              <div className="bookmarks-notes-pane">
                <div className="bookmarks-list-group">
                  <div className="group-header">
                    <span className="section-kicker">SAVED BOOKMARKS</span>
                    <span className="badge-count">{bookmarks.length}</span>
                  </div>
                  {bookmarks.length === 0 ? (
                    <p className="empty-subtext">No bookmarks yet.</p>
                  ) : (
                    [...bookmarks]
                      .sort((a, b) => a.page - b.page)
                      .map((bm) => (
                        <div key={bm.id} className="bookmark-item-row">
                          <button type="button" className="bookmark-jump-btn" onClick={() => { flowTo(bm.page); if (isNarrow()) setIsSidebarOpen(false); }}>
                            <BookmarkCheck size={14} className="bm-icon" />
                            <div>
                              <strong>Page {bm.page}</strong>
                              <span>{bm.title}</span>
                            </div>
                          </button>
                          <button type="button" className="icon-button delete-btn" onClick={() => removeBookmark(bm.id)} title="Remove bookmark">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}

            {sidebarTab === "annotations" && (
              <div className="annotations-pane">
                <div className="annotations-search">
                  <Search size={14} />
                  <input
                    placeholder="Search annotations"
                    value={annSearch}
                    onChange={(e) => setAnnSearch(e.target.value)}
                  />
                </div>
                <div className="annotations-filter-row">
                  {ANN_FILTERS.map((f) => {
                    const count =
                      f.id === "All"
                        ? annotations.length
                        : f.id === "bookmark"
                          ? bookmarks.length
                          : annotations.filter((a) => a.kind === f.id).length;
                    return (
                      <button
                        key={f.id}
                        className={annFilter === f.id ? "active" : ""}
                        onClick={() => setAnnFilter(f.id)}
                      >
                        {f.label}
                        <kbd>{count}</kbd>
                      </button>
                    );
                  })}
                </div>
                <div className="annotations-sort-row">
                  <span>Sort</span>
                  <select value={annSort} onChange={(e) => setAnnSort(e.target.value as AnnSort)}>
                    <option value="page">Page order</option>
                    <option value="recent">Recently created</option>
                    <option value="type">Type</option>
                  </select>
                </div>

                <div className="annotations-list">
                  {annFilter === "bookmark"
                    ? [...bookmarks]
                        .sort((a, b) => a.page - b.page)
                        .map((bm) => (
                          <button key={bm.id} className="annotation-entry" onClick={() => { flowTo(bm.page); if (isNarrow()) setIsSidebarOpen(false); }}>
                            <span className="entry-dot marker-yellow">
                              <Bookmark size={11} />
                            </span>
                            <div className="entry-body">
                              <strong>{bm.title}</strong>
                              <span className="entry-source">Page {bm.page}</span>
                            </div>
                          </button>
                        ))
                    : sidebarEntries.map((a) => {
                        const meta = ANNOTATION_META[a.kind];
                        return (
                          <div key={a.id} className={`annotation-entry ${activeMarker === a.id ? "active" : ""}`}>
                            <button className="entry-main" onClick={() => jumpToAnnotation(a)}>
                              <span className={`entry-dot marker-${a.color || meta.color}`}>
                                <meta.Icon size={11} />
                              </span>
                              <div className="entry-body">
                                <strong>{a.title || a.body || a.anchorText}</strong>
                                {(a.body || a.anchorText) && (
                                  <p>{a.title ? a.body || a.anchorText : a.anchorText}</p>
                                )}
                                <span className="entry-source">
                                  {meta.label} · p. {a.page}
                                  {a.chapter ? ` · ${a.chapter}` : ""} · {stampLabel(a.createdAt)}
                                </span>
                              </div>
                            </button>
                            <div className="entry-actions">
                              <button onClick={() => openEditExisting(a)} aria-label="Edit"><Pencil size={12} /></button>
                              {a.kind === "quote" && (
                                <button onClick={() => copyQuote(a)} aria-label="Copy quote"><Copy size={12} /></button>
                              )}
                              <button onClick={() => deleteAnnotation(a.id)} aria-label="Delete"><Trash2 size={12} /></button>
                            </div>
                          </div>
                        );
                      })}
                  {annFilter !== "bookmark" && sidebarEntries.length === 0 && (
                    <p className="empty-subtext">
                      Select any passage to add a note, quote, summary, question or highlight.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ================= MAIN READING CANVAS ================= */}
        <main className="reader-main-canvas" ref={canvasRef} onScroll={onCanvasScroll}>
          {readingMode === "paginated" && (
            <button
              type="button"
              className="canvas-nav-arrow left"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              aria-label="Previous Page"
            >
              <ChevronLeft size={28} />
            </button>
          )}

          <div
            className={`reader-page-wrapper ${readingMode}`}
            style={{ maxWidth: readingWidth, transform: readingMode === "paginated" ? `scale(${zoomLevel / 100})` : undefined }}
          >
            {readingMode === "continuous" && flowStart > 1 && (
              <button type="button" className="reader-load-earlier" onClick={loadEarlier}>
                <ChevronLeft size={14} />
                Load earlier pages
              </button>
            )}

            {visiblePages.map((page) => renderSheet(page))}

            {readingMode === "continuous" && (
              <div className="reader-flow-foot" ref={bottomSentinel}>
                {flowEnd < totalPages ? (
                  <span className="reader-flow-loading">
                    <span className="reader-flow-dot" aria-hidden="true" />
                    Loading page {Math.min(totalPages, flowEnd + 1)}…
                  </span>
                ) : (
                  <span className="reader-flow-end">End of {book.title}</span>
                )}
              </div>
            )}
          </div>

          {readingMode === "paginated" && (
            <button
              type="button"
              className="canvas-nav-arrow right"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              aria-label="Next Page"
            >
              <ChevronRight size={28} />
            </button>
          )}
        </main>
      </div>

      {/* ================= BOTTOM DOCK ================= */}
      <footer className={`reader-bottom-dock glass-card ${dockHidden ? "dock-hidden" : ""}`}>
        <div className="dock-left">
          <button type="button" className="dock-icon-btn" onClick={() => flowTo(currentPage - 1)} disabled={currentPage <= 1} title="Previous Page">
            <ChevronLeft size={18} />
          </button>
          <div className="page-indicator-pill">
            <span>Page</span>
            {/* Committed on Enter or blur. Jumping on every keystroke meant
                typing "50" went to page 5 first — restarting the flow and
                scrolling to the top — before it ever saw the 0. */}
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={totalPages}
              aria-label={`Page number, 1 to ${totalPages}`}
              value={pageDraft ?? currentPage}
              onChange={(e) => setPageDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setPageDraft(null);
              }}
              onBlur={() => {
                const val = parseInt(pageDraft ?? "", 10);
                setPageDraft(null);
                if (!Number.isNaN(val)) flowTo(Math.min(Math.max(1, val), totalPages));
              }}
            />
            <span className="total-of">of {totalPages}</span>
          </div>
          <button type="button" className="dock-icon-btn" onClick={() => flowTo(currentPage + 1)} disabled={currentPage >= totalPages} title="Next Page">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="dock-center">
          <div className="scrubber-track-wrap">
            <input
              type="range"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => flowTo(Number(e.target.value))}
              className="reader-scrubber-slider"
            />
            <div className="scrubber-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="scrubber-percent">{progressPercent}%</span>
        </div>

        <div className="dock-right">
          <button type="button" className="dock-icon-btn" onClick={() => setZoomLevel((z) => Math.max(75, z - 15))} title="Zoom Out">
            <ZoomOut size={16} />
          </button>
          <span className="zoom-level-text" onClick={() => setZoomLevel(100)} title="Reset to 100%">{zoomLevel}%</span>
          <button type="button" className="dock-icon-btn" onClick={() => setZoomLevel((z) => Math.min(150, z + 15))} title="Zoom In">
            <ZoomIn size={16} />
          </button>
        </div>
      </footer>

      {/* ================= FLOATING SELECTION TOOLBAR ================= */}
      {selection && !editor && (
        <div
          className="selection-toolbar"
          style={{
            left: Math.min(Math.max(selection.x, 150), window.innerWidth - 150),
            top: Math.max(selection.y - 14, 60),
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {highlightPicker ? (
            <div className="selection-highlight-colors">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  className={`hl-swatch marker-${color}`}
                  onClick={() => applyHighlight(color)}
                  aria-label={`Highlight ${color}`}
                />
              ))}
            </div>
          ) : (
            <>
              <button onClick={() => setHighlightPicker(true)} title="Highlight">
                <Highlighter size={15} />
                <span>Highlight</span>
              </button>
              <button onClick={() => openEditor("note")} title="Add Note">
                <StickyNote size={15} />
                <span>Note</span>
              </button>
              <button onClick={() => openEditor("quote")} title="Save Quote">
                <Quote size={15} />
                <span>Quote</span>
              </button>
              <button onClick={() => openEditor("summary")} title="Write Summary">
                <FileText size={15} />
                <span>Summary</span>
              </button>
              <button onClick={() => openEditor("question")} title="Add Question">
                <HelpCircle size={15} />
                <span>Question</span>
              </button>
              <button onClick={() => triggerToast("Ask AI is a design prototype in this build")} title="Ask AI">
                <Sparkles size={15} />
                <span>Ask AI</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* ================= ANNOTATION EDITOR ================= */}
      {editor && (
        <>
          <div className="annotation-editor-backdrop" onClick={() => setEditor(null)} />
          <div className="annotation-editor glass-card">
            <div className="editor-head">
              <span className={`entry-dot marker-${ANNOTATION_META[editor.kind].color}`}>
                {(() => {
                  const EditorIcon = ANNOTATION_META[editor.kind].Icon;
                  return <EditorIcon size={12} />;
                })()}
              </span>
              <strong>
                {editor.id ? "Edit " : ""}
                {ANNOTATION_META[editor.kind].label}
              </strong>
              <span className="editor-loc">Page {editor.page}</span>
              <button className="icon-button" onClick={() => setEditor(null)} aria-label="Close">
                <X size={15} />
              </button>
            </div>

            {editor.kind !== "note" && editor.anchorText && (
              <blockquote className="editor-source">“{editor.anchorText}”</blockquote>
            )}

            {editor.kind === "note" && (
              <input
                className="editor-title"
                placeholder="Title (optional)"
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
              />
            )}

            <textarea
              className="editor-body"
              autoFocus
              rows={4}
              placeholder={
                editor.kind === "note"
                  ? "Write a personal thought..."
                  : editor.kind === "quote"
                    ? "Add a personal comment (optional)..."
                    : editor.kind === "summary"
                      ? "Write your summary of this passage or chapter..."
                      : "Write your question about this passage..."
              }
              value={editor.body}
              onChange={(e) => setEditor({ ...editor, body: e.target.value })}
            />

            <div className="editor-tags">
              <Tag size={13} />
              <input
                placeholder="Tags, comma separated"
                value={editor.tags}
                onChange={(e) => setEditor({ ...editor, tags: e.target.value })}
              />
            </div>

            <div className="editor-actions">
              <button className="cancel-btn" onClick={() => setEditor(null)}>Cancel</button>
              <button className="save-btn" onClick={saveEditor}>
                <Check size={14} /> Save
              </button>
            </div>
          </div>
        </>
      )}

      {/* ================= MARKER CONTEXTUAL CARD ================= */}
      {activeAnnotation && !editor && (
        <>
          <div className="annotation-card-backdrop" onClick={() => setActiveMarker(null)} />
          <div className="annotation-card glass-card">
            <div className="ann-card-head">
              <span className={`entry-dot marker-${activeAnnotation.color || ANNOTATION_META[activeAnnotation.kind].color}`}>
                {(() => {
                  const CardIcon = ANNOTATION_META[activeAnnotation.kind].Icon;
                  return <CardIcon size={12} />;
                })()}
              </span>
              <div>
                <strong>{ANNOTATION_META[activeAnnotation.kind].label}</strong>
                <span className="ann-card-loc">
                  Page {activeAnnotation.page}
                  {activeAnnotation.chapter ? ` · ${activeAnnotation.chapter}` : ""}
                </span>
              </div>
              <button className="icon-button" onClick={() => setActiveMarker(null)} aria-label="Close">
                <X size={15} />
              </button>
            </div>

            {activeAnnotation.anchorText && (
              <blockquote className="ann-card-source">“{activeAnnotation.anchorText}”</blockquote>
            )}
            {activeAnnotation.title && <h4>{activeAnnotation.title}</h4>}
            {activeAnnotation.body && <p className="ann-card-body">{activeAnnotation.body}</p>}

            {activeAnnotation.kind === "highlight" && (
              <div className="ann-card-colors">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    className={`hl-swatch marker-${color} ${activeAnnotation.color === color ? "active" : ""}`}
                    onClick={() => updateAnnotation(activeAnnotation.id, { color })}
                    aria-label={`Set ${color}`}
                  />
                ))}
              </div>
            )}

            {activeAnnotation.tags && activeAnnotation.tags.length > 0 && (
              <div className="ann-card-tags">
                {activeAnnotation.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            )}

            <div className="ann-card-actions">
              <button onClick={() => jumpToAnnotation(activeAnnotation)}>
                <ArrowLeft size={13} style={{ transform: "rotate(-45deg)" }} /> Jump
              </button>
              {activeAnnotation.kind === "quote" && (
                <button onClick={() => copyQuote(activeAnnotation)}>
                  <Copy size={13} /> Copy
                </button>
              )}
              {activeAnnotation.kind !== "highlight" && (
                <button onClick={() => openEditExisting(activeAnnotation)}>
                  <Pencil size={13} /> Edit
                </button>
              )}
              <button className="danger" onClick={() => deleteAnnotation(activeAnnotation.id)}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        </>
      )}

      {toastMessage && (
        <div className="reader-toast" role="status">
          <Check size={14} />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
