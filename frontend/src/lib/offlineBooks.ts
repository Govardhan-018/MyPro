/**
 * Offline reading — "Download" saves a book's complete structured text (the
 * same `PdfTextDoc` JSON the reader renders: pages, paragraphs, chapters) into
 * IndexedDB under the very key the reader opens it by. Opening a downloaded
 * book therefore needs no network at all: the reader's text source reads the
 * device cache first and stops there.
 *
 * Where the text comes from, cheapest first:
 *   1. already complete on this device (opened before) → just pin it;
 *   2. the cloud copy (extracted once, on any device) → one download;
 *   3. the PDF on this device → extract every page here.
 *
 * Plus the book's notes/bookmarks are cached (readerCache) and the browser is
 * asked to keep the storage persistent, so it is not evicted under pressure.
 * The same code runs in the Android app (its WebView has IndexedDB too).
 */
import { useEffect, useState } from "react";
import {
  createPdfTextRemote,
  createPdfTextSource,
  isComplete,
  isPdfTextDoc,
  type PdfTextDoc,
} from "@mypro/shared";
import type { LibraryItem } from "../types/library";
import { api } from "./api";
import { isApiConfigured } from "./env";
import { pdfEngine } from "./pdfEngine";
import { writeReaderCache } from "./readerCache";
import {
  deleteExtractedText,
  deleteOfflineBook,
  getPdfBlobByAnyKey,
  listOfflineBooks,
  loadExtractedText,
  saveExtractedText,
  saveOfflineBook,
  type OfflineBookRecord,
} from "../utils/pdfStorage";

export type DownloadState =
  | { phase: "idle" }
  | { phase: "downloading"; percent: number; step: string }
  | { phase: "done"; record: OfflineBookRecord }
  | { phase: "failed"; reason: string };

/** The reader's cache key for a book — must match usePdfText. */
export const textKeyFor = (item: Pick<LibraryItem, "id" | "title">) => item.id ?? item.title;
const recordIdFor = textKeyFor;

/* ---- in-memory view, shared by every component that shows it ---- */

const records = new Map<string, OfflineBookRecord>();
const progress = new Map<string, DownloadState>();
const inflight = new Map<string, Promise<OfflineBookRecord>>();
const listeners = new Set<() => void>();
let loaded: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

function ensureLoaded(): Promise<void> {
  loaded ??= listOfflineBooks().then((rows) => {
    for (const row of rows) records.set(row.id, row);
    emit();
  });
  return loaded;
}

/* ---- download ---- */

async function fromCloud(itemId: string): Promise<PdfTextDoc | null> {
  if (!isApiConfigured) return null;
  try {
    const doc = await createPdfTextRemote(api.pdfText, itemId).load();
    return doc && isPdfTextDoc(doc) && isComplete(doc) ? doc : null;
  } catch {
    return null;
  }
}

/** Extract every page from the PDF on this device, reporting progress. */
function extractHere(item: LibraryItem, key: string, onPercent: (p: number) => void): Promise<PdfTextDoc> {
  return new Promise<PdfTextDoc>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      source.dispose();
      fn();
    };
    const check = () => {
      const doc = source.doc();
      if (source.pageCount) onPercent(Math.round((source.extracted / source.pageCount) * 100));
      if (doc && isComplete(doc)) return finish(() => resolve(doc));
      if (source.status === "unavailable") {
        return finish(() =>
          reject(new Error("This book’s PDF isn’t on this device, and no copy has been saved to the cloud yet.")),
        );
      }
      if (source.status === "scanned") {
        return finish(() => reject(new Error("This PDF is a scan with no readable text.")));
      }
      if (source.status === "error") return finish(() => reject(new Error(source.error ?? "Could not read this PDF.")));
    };
    const source = createPdfTextSource({
      key,
      fileName: item.pdfFileName,
      engine: pdfEngine,
      store: {
        load: (k) => loadExtractedText<PdfTextDoc>(k),
        save: (k, doc) => saveExtractedText(k, doc),
      },
      remote: item.id && isApiConfigured ? createPdfTextRemote(api.pdfText, item.id) : undefined,
      bytes: async () => {
        const blob = await getPdfBlobByAnyKey([item.id, item.title]);
        return blob ? blob.arrayBuffer() : null;
      },
      // Bigger chunks than the reader's: the user is waiting on this.
      chunkSize: 16,
      onChange: check,
    });
    // The source extracts the whole book in the background and reports each
    // step through onChange; a stalled boot (no PDF anywhere) is caught here.
    setTimeout(check, 0);
  });
}

async function runDownload(item: LibraryItem): Promise<OfflineBookRecord> {
  const id = recordIdFor(item);
  const key = textKeyFor(item);
  const set = (state: DownloadState) => {
    progress.set(id, state);
    emit();
  };
  set({ phase: "downloading", percent: 0, step: "Checking this device" });

  // Keep IndexedDB from being evicted when the device is low on space.
  void navigator.storage?.persist?.().catch(() => false);

  let doc = await loadExtractedText<PdfTextDoc>(key);
  if (!(doc && isPdfTextDoc(doc) && isComplete(doc))) {
    doc = null;
    if (item.id) {
      set({ phase: "downloading", percent: 5, step: "Downloading" });
      doc = await fromCloud(item.id);
      if (doc) await saveExtractedText(key, doc);
    }
  }
  if (!doc) {
    set({ phase: "downloading", percent: 5, step: "Preparing pages" });
    doc = await extractHere(item, key, (percent) =>
      set({ phase: "downloading", percent: Math.max(5, Math.min(99, percent)), step: "Preparing pages" }),
    );
    await saveExtractedText(key, doc);
  }

  // The notes and bookmarks travel with the book.
  if (item.id && isApiConfigured) {
    set({ phase: "downloading", percent: 99, step: "Saving your notes" });
    try {
      const [annotations, bookmarks] = await Promise.all([
        api.reader.annotations(item.id),
        api.reader.bookmarks(item.id),
      ]);
      writeReaderCache(item.id, annotations, bookmarks);
    } catch {
      /* the reader still opens; its notes come from the last time it was opened */
    }
  }

  const record: OfflineBookRecord = {
    id,
    textKey: key,
    title: item.title,
    creator: item.creator || undefined,
    cover: item.image || undefined,
    pageCount: doc.pageCount,
    chapters: doc.toc?.length ?? 0,
    version: doc.extractedAt,
    sizeBytes: new Blob([JSON.stringify(doc)]).size,
    savedAt: new Date().toISOString(),
  };
  await saveOfflineBook(record);
  records.set(id, record);
  set({ phase: "done", record });
  return record;
}

export const offlineBooks = {
  /**
   * Download a book for offline reading. Calling it again while it runs
   * joins the same download; calling it for a book already saved with the
   * same text version does nothing.
   */
  async download(item: LibraryItem): Promise<OfflineBookRecord> {
    await ensureLoaded();
    const id = recordIdFor(item);
    const running = inflight.get(id);
    if (running) return running;
    const existing = records.get(id);
    if (existing) {
      const doc = await loadExtractedText<PdfTextDoc>(existing.textKey);
      if (doc && isComplete(doc) && doc.extractedAt === existing.version) return existing;
    }
    const task = runDownload(item)
      .catch((error: unknown) => {
        progress.set(id, {
          phase: "failed",
          reason: error instanceof Error ? error.message : "The download failed.",
        });
        emit();
        throw error;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, task);
    return task;
  },

  /** Remove a download and the text it saved (frees the space). */
  async remove(item: Pick<LibraryItem, "id" | "title">): Promise<void> {
    await ensureLoaded();
    const id = recordIdFor(item);
    const record = records.get(id);
    await deleteOfflineBook(id);
    await deleteExtractedText(record?.textKey ?? textKeyFor(item));
    records.delete(id);
    progress.delete(id);
    emit();
  },

  get(item: Pick<LibraryItem, "id" | "title">): OfflineBookRecord | null {
    return records.get(recordIdFor(item)) ?? null;
  },

  state(item: Pick<LibraryItem, "id" | "title">): DownloadState {
    const id = recordIdFor(item);
    const live = progress.get(id);
    if (live && live.phase !== "done") return live;
    const record = records.get(id);
    return record ? { phase: "done", record } : { phase: "idle" };
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    void ensureLoaded();
    return () => void listeners.delete(listener);
  },
};

/** Re-render when any download starts, progresses, finishes or is removed. */
export function useOfflineBooks(): typeof offlineBooks {
  const [, setTick] = useState(0);
  useEffect(() => offlineBooks.subscribe(() => setTick((t) => t + 1)), []);
  return offlineBooks;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
