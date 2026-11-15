/**
 * Shared PDF → text core (Roadmap Phase 10).
 *
 * Platform-free on purpose: no DOM, no React Native, no pdfjs import. The
 * host injects a {@link PdfEngine} (web: pdfjs-dist), a {@link PdfTextStore}
 * (web: IndexedDB; Android: the filesystem) and a {@link PdfTextRemote}
 * (Supabase Storage, brokered by backend-render).
 *
 * The division of labour matches Phase 10.2 — extraction happens on the device
 * that holds the raw PDF, and only the structured JSON travels:
 *
 *   web (has the file)     → engine extracts → cache locally → upload JSON
 *   Android (no file)      → download JSON → read
 */

// ---------------------------------------------------------------------------
// The extracted document (this is the JSON that lands in Supabase Storage)
// ---------------------------------------------------------------------------

/**
 * What a run of text is, structurally. Derived from type size relative to the
 * page's body text, not from guessing at the words.
 */
export type PdfBlockKind = "heading" | "subheading" | "paragraph" | "caption";

export interface PdfBlock {
  kind: PdfBlockKind;
  text: string;
  /** 1 or 2 for headings — the outline depth the size implies. */
  level?: number;
}

/** One extracted page. `empty` means the page carried no selectable text. */
export interface PdfPage {
  page: number;
  /**
   * The page as structured blocks. The reader renders from this.
   */
  blocks?: PdfBlock[];
  /**
   * Body paragraphs only, flattened. Kept alongside `blocks` because the
   * annotation anchors (page + paragraph index) are stored against it, and
   * Android reads it directly.
   */
  paragraphs: string[];
  /** The running header this page carried, if it had one. */
  runningHead?: string;
  /** The first heading on the page, for the contents and the crumb. */
  heading?: string;
  empty?: boolean;
  /**
   * This page was read by text recognition, not pulled from a text layer
   * (Phase 10.4). Recorded so nothing downstream mistakes machine-read text
   * for the real thing: there are no font metrics behind it, so every line
   * arrives as a paragraph and `blocks` carries no heading ranks.
   */
  ocr?: boolean;
}

/** The document's own header information, as the file declares it. */
export interface PdfDocInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  created?: string;
  modified?: string;
  pageSize?: { width: number; height: number };
}

export interface PdfTocEntry {
  id: string;
  title: string;
  page: number;
  part?: string;
}

/**
 * The on-disk / on-cloud shape. `pages` is keyed by page number as a string
 * so the document round-trips through JSON unchanged.
 */
export interface PdfTextDoc {
  version: 1;
  pageCount: number;
  pages: Record<string, PdfPage>;
  toc: PdfTocEntry[];
  extractedAt: string;
  /** Title, author and the rest of the PDF's own header block. */
  info?: PdfDocInfo;
  /**
   * True when no page yielded text and nothing could recognise it either —
   * an image-only PDF that is not readable as text at all.
   */
  scanned?: boolean;
  /** This document was read by text recognition (Phase 10.4). */
  ocr?: boolean;
  fileName?: string;
}

export function emptyDoc(pageCount: number, fileName?: string): PdfTextDoc {
  return {
    version: 1,
    pageCount,
    pages: {},
    toc: [],
    extractedAt: new Date().toISOString(),
    fileName,
  };
}

/** True when every page of the document has been extracted. */
export function isComplete(doc: PdfTextDoc): boolean {
  return doc.pageCount > 0 && Object.keys(doc.pages).length >= doc.pageCount;
}

/** Cheap structural validation for JSON arriving from cache or the cloud. */
export function isPdfTextDoc(value: unknown): value is PdfTextDoc {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<PdfTextDoc>;
  return doc.version === 1 && typeof doc.pageCount === 'number' && !!doc.pages;
}

// ---------------------------------------------------------------------------
// The platform seam
// ---------------------------------------------------------------------------

/** A positioned run of text, as every PDF engine reports it. */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The engine knows this run ends its line (pdfjs: `hasEOL`). */
  eol?: boolean;
  /** The font this run is set in — "...Bold" is how weight is detectable. */
  font?: string;
}

export interface PdfOutlineNode {
  title: string;
  page: number | null;
  children?: PdfOutlineNode[];
}

/** One open PDF. */
/**
 * A rasterised page, for OCR (Phase 10.4). PNG bytes rather than raw pixels:
 * every OCR engine takes an encoded image, and it crosses a worker boundary
 * far more cheaply than an ImageData buffer.
 */
export interface PdfPageImage {
  page: number;
  bytes: ArrayBuffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface PdfHandle {
  pageCount: number;
  textItems(page: number): Promise<PdfTextItem[]>;
  outline?(): Promise<PdfOutlineNode[]>;
  /** Title, author, producer… as the file declares them. */
  info?(): Promise<PdfDocInfo>;
  /**
   * Render a page to an image, for OCR. Optional: only an engine that can
   * actually draw (pdfjs on a canvas) implements it, which is why a scanned
   * book stays `scanned` on Android rather than pretending to recognise it.
   */
  renderPage?(page: number, scale?: number): Promise<PdfPageImage | null>;
  close?(): void | Promise<void>;
}

/** Opens PDF bytes. Web implementation wraps pdfjs-dist. */
export interface PdfEngine {
  open(bytes: ArrayBuffer): Promise<PdfHandle>;
}

/**
 * Text recognition for a page image — Phase 10.4.
 *
 * Kept behind a seam for the same reason as {@link PdfEngine}: the recogniser
 * is large, platform-specific and lazily loaded, and the shared core must not
 * know which one is in use. It runs on the device, so a scanned PDF is never
 * uploaded anywhere to be read.
 */
export interface PdfOcr {
  recognize(image: PdfPageImage): Promise<string>;
  /** Release the worker once a book is done with it. */
  dispose?(): void | Promise<void>;
}

/** Device-local cache of the extracted JSON. */
export interface PdfTextStore {
  load(key: string): Promise<PdfTextDoc | null>;
  save(key: string, doc: PdfTextDoc): Promise<void>;
}

/** The cloud copy (Supabase Storage via Render-brokered signed URLs). */
export interface PdfTextRemote {
  load(): Promise<PdfTextDoc | null>;
  save(doc: PdfTextDoc): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure text shaping — the part worth sharing between platforms
// ---------------------------------------------------------------------------

interface Line {
  text: string;
  y: number;
  x: number;
  height: number;
  width: number;
  font?: string;
}

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Collapse runs into lines, using the engine's EOL flags when it has them. */
function toLines(items: PdfTextItem[]): Line[] {
  const usable = items.filter((item) => item.text !== undefined && item.text !== null);
  if (!usable.length) return [];
  const hasEol = usable.some((item) => item.eol);
  const lines: Line[] = [];

  let buffer: PdfTextItem[] = [];
  const flush = () => {
    if (!buffer.length) return;
    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    let text = '';
    buffer.forEach((item, index) => {
      if (index > 0) {
        const previous = buffer[index - 1];
        const gap = item.x - (previous.x + previous.width);
        const needsSpace =
          gap > Math.max(1, previous.height * 0.2) &&
          !/\s$/.test(text) &&
          !/^\s/.test(item.text);
        if (needsSpace) text += ' ';
      }
      text += item.text;
    });
    text = text.replace(/\s+/g, ' ').trim();
    if (text) {
      lines.push({
        text,
        y: first.y,
        x: first.x,
        height: median(buffer.map((item) => item.height)) || first.height,
        width: last.x + last.width - first.x,
        font: first.font,
      });
    }
    buffer = [];
  };

  if (hasEol) {
    for (const item of usable) {
      // pdfjs emits a zero-size, empty item carrying the EOL flag, positioned
      // on the *next* line. Joining it would give the line a width of zero
      // and let the next line's font bleed into this one's metrics.
      if (!item.text) {
        if (item.eol) flush();
        continue;
      }
      buffer.push(item);
      if (item.eol) flush();
    }
    flush();
    return lines;
  }

  // No EOL information: group by baseline proximity instead.
  const sorted = [...usable].sort((a, b) => (b.y - a.y) || (a.x - b.x));
  for (const item of sorted) {
    const current = buffer[0];
    const tolerance = Math.max(1, (current?.height ?? item.height) * 0.5);
    if (current && Math.abs(current.y - item.y) > tolerance) flush();
    buffer.push(item);
  }
  flush();
  return lines;
}

/** A line that is only a page number (or roman numeral) is furniture. */
function isPageFurniture(text: string): boolean {
  return /^[\s.·—-]*(?:\d{1,4}|[ivxlcdm]{1,7})[\s.·—-]*$/i.test(text);
}

/**
 * Turn one page's positioned text into reading paragraphs.
 *
 * Paragraph breaks come from three signals, in order of reliability: a
 * vertical gap wider than the page's normal leading, a fresh first-line
 * indent, and a short previous line that ended a sentence (headings and
 * closing lines). Line-end hyphens are stitched back together.
 */
export function groupParagraphs(items: PdfTextItem[]): string[] {
  const all = toLines(items);
  if (!all.length) return [];

  // Drop page numbers at the very top/bottom of the page only.
  const lines = all.filter(
    (line, index) =>
      !((index === 0 || index === all.length - 1) && isPageFurniture(line.text)),
  );
  if (!lines.length) return [];

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    if (gap > 0) gaps.push(gap);
  }
  // Body leading is the *tight* end of the gaps on a page: paragraph breaks,
  // headings and figures all widen the distribution, and a plain median gets
  // dragged up by them on short pages. The lower quartile tracks the real
  // line spacing instead.
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const leading = sortedGaps.length
    ? sortedGaps[Math.floor((sortedGaps.length - 1) * 0.25)]
    : lines[0].height * 1.2;
  const bodyIndent = median(lines.map((line) => line.x));
  const maxWidth = Math.max(...lines.map((line) => line.width));

  const paragraphs: string[] = [];
  let current = '';

  const push = () => {
    const text = current.replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
    current = '';
  };

  lines.forEach((line, index) => {
    if (index === 0) {
      current = line.text;
      return;
    }
    const previous = lines[index - 1];
    const gap = Math.abs(previous.y - line.y);
    const wideGap = gap > leading * 1.45;
    const indented = line.x > bodyIndent + line.height * 0.6;
    const previousWasShort = previous.width < maxWidth * 0.72;
    // A line far shorter than the measure is a heading or a stub line, not the
    // middle of a paragraph — even when it carries no closing punctuation.
    const previousWasStub = previous.width < maxWidth * 0.5;
    const sentenceEnded = /[.!?"”’:]$/.test(previous.text);

    if (wideGap || indented || previousWasStub || (previousWasShort && sentenceEnded)) {
      push();
      current = line.text;
      return;
    }
    // Same paragraph: stitch hyphenated words, otherwise join with a space.
    if (/[\p{L}]-$/u.test(current)) {
      current = `${current.slice(0, -1)}${line.text}`;
    } else {
      current = `${current} ${line.text}`;
    }
  });
  push();

  return paragraphs;
}

/**
 * Turn one page's positioned text into structured blocks.
 *
 * Headings are found by type size relative to the page's own body text, so it
 * works whatever the book sets its body in. Everything that is not a heading
 * is merged into reading paragraphs exactly as before.
 */
export function groupBlocks(items: PdfTextItem[]): PdfBlock[] {
  const all = toLines(items);
  if (!all.length) return [];

  const lines = all.filter(
    (line, index) =>
      !((index === 0 || index === all.length - 1) && isPageFurniture(line.text)),
  );
  if (!lines.length) return [];

  // The body is whatever size most of the page is set in.
  const bodySize = median(lines.map((line) => line.height)) || lines[0].height;
  const maxWidth = Math.max(...lines.map((line) => line.width));

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    if (gap > 0) gaps.push(gap);
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const leading = sortedGaps.length
    ? sortedGaps[Math.floor((sortedGaps.length - 1) * 0.25)]
    : bodySize * 1.2;
  const bodyIndent = median(lines.map((line) => line.x));

  const gapAbove = (index: number) =>
    index === 0 ? Infinity : Math.abs(lines[index - 1].y - lines[index].y);
  const gapBelow = (index: number) =>
    index === lines.length - 1 ? Infinity : Math.abs(lines[index].y - lines[index + 1].y);

  const kindOf = (line: Line, index: number): PdfBlockKind => {
    const ratio = line.height / bodySize;
    const bold = /bold|black|heavy|semibold/i.test(line.font ?? "");
    if (ratio >= 1.42) return "heading";
    if (ratio >= 1.15) return "subheading";
    if (ratio <= 0.84) return "caption";
    // Same size as the body, but set apart: a short line with no terminal
    // punctuation that sits closer to what follows than to what precedes it
    // is a run-in heading, not the last line of the paragraph above.
    const short = line.width < maxWidth * 0.62;
    const unpunctuated = !/[.!?;:,—]$/.test(line.text);
    const belongsBelow = gapAbove(index) > gapBelow(index) * 1.25;
    if (short && unpunctuated && (bold || belongsBelow)) return "subheading";
    return "paragraph";
  };

  const blocks: PdfBlock[] = [];
  let current = "";
  let currentKind: PdfBlockKind | null = null;

  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text && currentKind) {
      blocks.push({
        kind: currentKind,
        text,
        ...(currentKind === "heading"
          ? { level: 1 }
          : currentKind === "subheading"
            ? { level: 2 }
            : {}),
      });
    }
    current = "";
  };

  lines.forEach((line, index) => {
    const kind = kindOf(line, index);
    if (index === 0) {
      current = line.text;
      currentKind = kind;
      return;
    }
    const previous = lines[index - 1];
    const gap = Math.abs(previous.y - line.y);
    const wideGap = gap > leading * 1.45;
    const indented = line.x > bodyIndent + line.height * 0.6;
    const previousWasStub = previous.width < maxWidth * 0.5;
    const sentenceEnded = /[.!?"”’:]$/.test(previous.text);
    const previousWasShort = previous.width < maxWidth * 0.72;

    // A change of kind always starts a new block; otherwise the usual
    // paragraph signals apply.
    if (
      kind !== currentKind ||
      wideGap ||
      indented ||
      previousWasStub ||
      (previousWasShort && sentenceEnded)
    ) {
      flush();
      current = line.text;
      currentKind = kind;
      return;
    }
    if (/[\p{L}]-$/u.test(current)) {
      current = `${current.slice(0, -1)}${line.text}`;
    } else {
      current = `${current} ${line.text}`;
    }
  });
  flush();

  return blocks;
}

/** The body paragraphs of a page, in reading order. */
export function paragraphsOf(blocks: PdfBlock[]): string[] {
  return blocks.filter((block) => block.kind === "paragraph").map((block) => block.text);
}

/** Flatten an engine outline into the reader's flat TOC (top level → part). */
export function outlineToToc(nodes: PdfOutlineNode[]): PdfTocEntry[] {
  const out: PdfTocEntry[] = [];
  const walk = (list: PdfOutlineNode[], part?: string) => {
    for (const node of list) {
      const title = node.title.replace(/\s+/g, ' ').trim();
      if (title && typeof node.page === 'number' && node.page > 0) {
        out.push({ id: `toc-${out.length + 1}`, title, page: node.page, part });
      }
      if (node.children?.length) walk(node.children, part ?? title ?? undefined);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Two page-top lines are the same running head when they differ only by their
 * page numbers ("The Creative Act   128" vs "The Creative Act   129").
 */
function sameRunningHead(a: string, b: string): boolean {
  const normalise = (text: string) =>
    text.replace(/\d+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const left = normalise(a);
  return left.length > 2 && left === normalise(b);
}

/** The TOC chapter covering a page (the last entry at or before it). */
export function chapterAt(toc: PdfTocEntry[], page: number): PdfTocEntry | null {
  let found: PdfTocEntry | null = null;
  for (const entry of toc) {
    if (entry.page <= page && (!found || entry.page >= found.page)) found = entry;
  }
  return found;
}

// ---------------------------------------------------------------------------
// The source: lazy extraction, caching, background completion, upload
// ---------------------------------------------------------------------------

export type PdfStatus =
  /** No PDF is associated with this item. */
  | 'unavailable'
  /** Opening the file / fetching the cached JSON. */
  | 'loading'
  /** Text is available for reading (possibly still filling in behind). */
  | 'ready'
  /** Readable, and the remaining pages are being extracted in the background. */
  | 'extracting'
  /**
   * The PDF has no selectable text at all, and nothing on this device can
   * recognise it. With an {@link PdfOcr} supplied the source goes to `ocr`
   * instead and only lands here if recognition finds nothing either.
   */
  | 'scanned'
  /** Reading a scanned PDF with text recognition (Phase 10.4). */
  | 'ocr'
  | 'error';

export interface PdfTextSourceOptions {
  /** Cache key — the library item id (falls back to its title). */
  key: string;
  /** The raw bytes, when this device holds the file. */
  bytes?: () => Promise<ArrayBuffer | null>;
  /** Extractor for those bytes. Omit on devices that only read the JSON. */
  engine?: PdfEngine;
  /**
   * Text recognition, for a PDF with no text layer (Phase 10.4). Optional:
   * without it a scanned book reports `scanned` and says so, which is what
   * Android does — it has no renderer to rasterise pages with.
   */
  ocr?: PdfOcr;
  /** Device-local cache of extracted JSON. */
  store?: PdfTextStore;
  /** The cloud copy. */
  remote?: PdfTextRemote;
  fileName?: string;
  /** How many pages around the current one to extract eagerly. */
  window?: number;
  /** Pages per background chunk (keeps the UI responsive). */
  chunkSize?: number;
  onChange?: () => void;
}

export interface PdfTextSource {
  readonly status: PdfStatus;
  readonly pageCount: number;
  readonly toc: PdfTocEntry[];
  readonly error: string | null;
  /** Pages extracted so far (for the progress line). */
  readonly extracted: number;
  /** Already-extracted text for a page, or null if not extracted yet. */
  page(page: number): PdfPage | null;
  /** Extract a page and its neighbours if needed. */
  ensure(page: number): Promise<void>;
  doc(): PdfTextDoc | null;
  dispose(): void;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Open a PDF's text. Resolution order: local cache → cloud JSON → extract
 * from the bytes on this device. Once extraction completes, the JSON is
 * cached locally and pushed to the cloud so other devices read it for free.
 */
export function createPdfTextSource(options: PdfTextSourceOptions): PdfTextSource {
  const windowSize = options.window ?? 2;
  const chunkSize = options.chunkSize ?? 8;

  let status: PdfStatus = 'loading';
  let error: string | null = null;
  let doc: PdfTextDoc | null = null;
  let handle: PdfHandle | null = null;
  let disposed = false;
  let backgroundRunning = false;
  let dirty = false;

  const notify = () => {
    if (!disposed) options.onChange?.();
  };
  const setStatus = (next: PdfStatus) => {
    if (status === next) return;
    status = next;
    notify();
  };

  const persist = async () => {
    if (!doc || !dirty) return;
    dirty = false;
    const snapshot = doc;
    try {
      await options.store?.save(options.key, snapshot);
    } catch {
      /* the cache is a convenience; reading must not fail because of it */
    }
    if (isComplete(snapshot)) {
      try {
        await options.remote?.save(snapshot);
      } catch {
        /* offline or not signed in — the next completed read retries */
      }
    }
  };

  const extract = async (page: number): Promise<void> => {
    if (!handle || !doc || disposed) return;
    if (doc.pages[String(page)]) return;
    if (page < 1 || page > doc.pageCount) return;
    try {
      const blocks = groupBlocks(await handle.textItems(page));
      if (disposed || !doc) return;

      // A line repeated at the top of consecutive pages is the running head
      // (book or chapter title), not part of the text.
      const previous = doc.pages[String(page - 1)] ?? doc.pages[String(page + 1)];
      let runningHead: string | undefined;
      const first = blocks[0];
      if (first && previous?.blocks?.[0] && sameRunningHead(first.text, previous.blocks[0].text)) {
        runningHead = first.text;
        blocks.shift();
      }

      const paragraphs = paragraphsOf(blocks);
      const heading = blocks.find((block) => block.kind === "heading")?.text;
      doc.pages[String(page)] = {
        page,
        blocks,
        paragraphs,
        ...(runningHead ? { runningHead } : {}),
        ...(heading ? { heading } : {}),
        ...(blocks.length ? {} : { empty: true }),
      };
      dirty = true;
      notify();
    } catch (err) {
      // One unreadable page must not take the whole book down.
      doc.pages[String(page)] = { page, blocks: [], paragraphs: [], empty: true };
      dirty = true;
      notify();
      if (!(err instanceof Error)) return;
    }
  };

  /** Fill in the rest of the book behind the reader, a chunk at a time. */
  const runBackground = async () => {
    if (backgroundRunning || !handle || !doc) return;
    backgroundRunning = true;
    setStatus('extracting');
    try {
      for (let page = 1; page <= doc.pageCount; page += chunkSize) {
        if (disposed) return;
        for (let p = page; p < page + chunkSize && p <= doc.pageCount; p++) {
          await extract(p);
        }
        await yieldToUi();
      }
      if (disposed || !doc) return;
      const anyText = Object.values(doc.pages).some((p) => p.paragraphs.length > 0);

      if (!anyText && canOcr()) {
        // Nothing selectable anywhere: this is a scan. Recognising it is the
        // difference between a book you can read and a file you cannot.
        await runOcr();
        return;
      }

      doc.scanned = !anyText;
      dirty = true;
      await persist();
      setStatus(anyText ? 'ready' : 'scanned');
    } finally {
      backgroundRunning = false;
    }
  };

  const canOcr = (): boolean => Boolean(options.ocr && handle?.renderPage);

  /**
   * Read a scanned book with text recognition — Phase 10.4.
   *
   * Front to back, one page at a time, persisting as it goes. OCR is orders
   * of magnitude slower than pulling out a text layer — seconds per page, not
   * milliseconds — so three things matter:
   *
   *  - **Pages become readable as they finish.** The reader shows page one
   *    while page forty is still being recognised.
   *  - **Progress survives a closed tab.** Every page is written to the cache,
   *    so reopening the book resumes instead of starting again.
   *  - **The UI keeps breathing.** A yield between pages, as the text pass does.
   *
   * Recognised pages carry `ocr: true`, so nothing downstream mistakes
   * machine-read text for the real thing: the structure heuristics have no
   * font metrics to work from here, and every line arrives as a paragraph.
   */
  const runOcr = async () => {
    if (!doc || !handle?.renderPage || !options.ocr) return;
    setStatus('ocr');

    const ocr = options.ocr;
    const render = handle.renderPage.bind(handle);
    let recognised = 0;

    try {
      for (let page = 1; page <= doc.pageCount; page++) {
        if (disposed || !doc) return;
        // A page already recognised in an earlier sitting is left alone.
        if (doc.pages[String(page)]?.paragraphs.length) continue;

        try {
          // 2× renders text large enough for recognition without making the
          // image so big that a long book exhausts memory.
          const image = await render(page, 2);
          if (!image || disposed || !doc) continue;

          const text = await ocr.recognize(image);
          if (disposed || !doc) return;

          const paragraphs = ocrParagraphs(text);
          doc.pages[String(page)] = {
            page,
            // One block per paragraph: without font metrics there is no
            // honest way to tell a heading from a line of body text.
            blocks: paragraphs.map((paragraph) => ({ kind: 'paragraph', text: paragraph })),
            paragraphs,
            ocr: true,
            ...(paragraphs.length ? {} : { empty: true }),
          };
          if (paragraphs.length) recognised += 1;
          dirty = true;
          notify();
        } catch {
          // A page the recogniser chokes on is marked empty and skipped,
          // exactly as an unreadable page is in the text pass.
          doc.pages[String(page)] = { page, blocks: [], paragraphs: [], empty: true, ocr: true };
          dirty = true;
          notify();
        }

        // Persist every few pages rather than every page: the whole document
        // is rewritten each time, and that cost grows with the book.
        if (page % 4 === 0) await persist();
        await yieldToUi();
      }

      if (disposed || !doc) return;
      doc.ocr = true;
      // Still nothing after recognition: an image-only PDF of photographs,
      // say. `scanned` is then the honest final answer.
      doc.scanned = recognised === 0;
      dirty = true;
      await persist();
      setStatus(recognised > 0 ? 'ready' : 'scanned');
    } finally {
      // The worker holds a few tens of megabytes; let it go.
      try {
        await options.ocr?.dispose?.();
      } catch {
        /* nothing useful to do if teardown fails */
      }
    }
  };

  const openFromEngine = async (): Promise<boolean> => {
    if (!options.engine || !options.bytes) return false;
    const bytes = await options.bytes();
    if (!bytes || disposed) return false;
    handle = await options.engine.open(bytes);
    doc = emptyDoc(handle.pageCount, options.fileName);
    if (handle.info) {
      try {
        doc.info = await handle.info();
      } catch {
        /* a PDF without an info dictionary is normal */
      }
    }
    if (handle.outline) {
      try {
        doc.toc = outlineToToc(await handle.outline());
      } catch {
        doc.toc = [];
      }
    }
    dirty = true;
    // Show the opening pages first, then fill the rest in behind.
    for (let p = 1; p <= Math.min(1 + windowSize, doc.pageCount); p++) await extract(p);
    setStatus('ready');
    void runBackground();
    return true;
  };

  const boot = async () => {
    try {
      const cached = (await options.store?.load(options.key)) ?? null;
      if (disposed) return;
      if (cached && isPdfTextDoc(cached) && isComplete(cached)) {
        doc = cached;
        setStatus(cached.scanned ? 'scanned' : 'ready');
        return;
      }
      // A cloud miss (offline, signed out, nothing uploaded yet) is ordinary:
      // it must not abort the boot and leave the reader claiming the PDF is
      // unreadable when it can still extract locally or fall back.
      let remote: PdfTextDoc | null = null;
      if (!cached) {
        try {
          remote = (await options.remote?.load()) ?? null;
        } catch {
          remote = null;
        }
      }
      if (disposed) return;
      if (remote && isPdfTextDoc(remote) && isComplete(remote)) {
        doc = remote;
        try {
          await options.store?.save(options.key, remote);
        } catch {
          /* cache only */
        }
        setStatus(remote.scanned ? 'scanned' : 'ready');
        return;
      }
      // Partially-extracted cache: keep it and carry on from the engine.
      if (cached && isPdfTextDoc(cached)) doc = cached;

      if (await openFromEngine()) return;
      if (doc && Object.keys(doc.pages).length) {
        setStatus('ready');
        return;
      }
      setStatus('unavailable');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not read this PDF';
      setStatus('error');
    }
  };

  void boot();

  return {
    get status() {
      return status;
    },
    get pageCount() {
      return doc?.pageCount ?? 0;
    },
    get toc() {
      return doc?.toc ?? [];
    },
    get error() {
      return error;
    },
    get extracted() {
      return doc ? Object.keys(doc.pages).length : 0;
    },
    page: (page: number) => doc?.pages[String(page)] ?? null,
    ensure: async (page: number) => {
      if (!handle || !doc) return;
      for (let p = Math.max(1, page - 1); p <= Math.min(doc.pageCount, page + windowSize); p++) {
        await extract(p);
      }
      await persist();
    },
    doc: () => doc,
    dispose: () => {
      disposed = true;
      void handle?.close?.();
      handle = null;
    },
  };
}

/**
 * Shape recognised text into reading paragraphs — Phase 10.4.
 *
 * OCR output is lines, and the cues the text pass relies on (leading, indent,
 * font size, EOL flags) do not exist here. What is left is blank lines, which
 * Tesseract emits between blocks it believes are separate, plus one rule worth
 * keeping from the text pass: a line ending in a hyphen is a word split across
 * the line break, and stitching it back is the difference between "recog-
 * nition" and "recognition".
 */
export function ocrParagraphs(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (!current.length) return;
    let joined = '';
    for (const line of current) {
      if (!joined) {
        joined = line;
      } else if (joined.endsWith('-')) {
        // Drop the hyphen and close the word up.
        joined = `${joined.slice(0, -1)}${line}`;
      } else {
        joined = `${joined} ${line}`;
      }
    }
    const cleaned = joined.replace(/\s+/g, ' ').trim();
    // Single stray characters are recognition noise, not text.
    if (cleaned.length > 1) out.push(cleaned);
    current = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();

  return out;
}
