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

/** One extracted page. `empty` means the page carried no selectable text. */
export interface PdfPage {
  page: number;
  paragraphs: string[];
  empty?: boolean;
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
  /** True when no page yielded text — i.e. a scanned PDF needing OCR. */
  scanned?: boolean;
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
}

export interface PdfOutlineNode {
  title: string;
  page: number | null;
  children?: PdfOutlineNode[];
}

/** One open PDF. */
export interface PdfHandle {
  pageCount: number;
  textItems(page: number): Promise<PdfTextItem[]>;
  outline?(): Promise<PdfOutlineNode[]>;
  close?(): void | Promise<void>;
}

/** Opens PDF bytes. Web implementation wraps pdfjs-dist. */
export interface PdfEngine {
  open(bytes: ArrayBuffer): Promise<PdfHandle>;
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
      });
    }
    buffer = [];
  };

  if (hasEol) {
    for (const item of usable) {
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
  /** The PDF has no selectable text at all — needs OCR (Phase 10.4). */
  | 'scanned'
  | 'error';

export interface PdfTextSourceOptions {
  /** Cache key — the library item id (falls back to its title). */
  key: string;
  /** The raw bytes, when this device holds the file. */
  bytes?: () => Promise<ArrayBuffer | null>;
  /** Extractor for those bytes. Omit on devices that only read the JSON. */
  engine?: PdfEngine;
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
      const paragraphs = groupParagraphs(await handle.textItems(page));
      if (disposed || !doc) return;
      doc.pages[String(page)] = {
        page,
        paragraphs,
        ...(paragraphs.length ? {} : { empty: true }),
      };
      dirty = true;
      notify();
    } catch (err) {
      // One unreadable page must not take the whole book down.
      doc.pages[String(page)] = { page, paragraphs: [], empty: true };
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
      doc.scanned = !anyText;
      dirty = true;
      await persist();
      setStatus(anyText ? 'ready' : 'scanned');
    } finally {
      backgroundRunning = false;
    }
  };

  const openFromEngine = async (): Promise<boolean> => {
    if (!options.engine || !options.bytes) return false;
    const bytes = await options.bytes();
    if (!bytes || disposed) return false;
    handle = await options.engine.open(bytes);
    doc = emptyDoc(handle.pageCount, options.fileName);
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
      const remote = cached ? null : ((await options.remote?.load()) ?? null);
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
