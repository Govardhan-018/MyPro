/**
 * The reader's PDF text (Phases 10.1 / 10.3, and 10.4 for scans).
 *
 * Assembles the halves the shared core asks for:
 *   engine → pdfjs on this device
 *   ocr    → Tesseract, for a PDF with no text layer at all
 *   store  → the IndexedDB vault that already holds the PDF blob
 *   remote → the extracted JSON in Supabase Storage, brokered by Render
 *
 * Opening a book resolves in that order (cache → cloud → extract), so the
 * second open of a book is instant and a book extracted on the laptop needs
 * no re-extraction on another device.
 */
import { useEffect, useRef, useState } from "react";
import {
  createPdfTextRemote,
  createPdfTextSource,
  type PdfTextDoc,
  type PdfTextSource,
  type PdfTextStore,
} from "@mypro/shared";
import type { LibraryItem } from "../types/library";
import { api } from "./api";
import { isApiConfigured } from "./env";
import { pdfEngine } from "./pdfEngine";
import { createPdfOcr } from "./pdfOcr";
import {
  getPdfBlobByAnyKey,
  loadExtractedText,
  saveExtractedText,
} from "../utils/pdfStorage";

const store: PdfTextStore = {
  load: (key) => loadExtractedText<PdfTextDoc>(key),
  save: (key, doc) => saveExtractedText(key, doc),
};

/** What the reader renders from. `null` until the first open resolves. */
export interface PdfTextState {
  source: PdfTextSource | null;
  /** Bumped on every change so React re-renders as pages fill in. */
  revision: number;
}

export function usePdfText(book: LibraryItem | null, enabled: boolean): PdfTextState {
  const [source, setSource] = useState<PdfTextSource | null>(null);
  const [revision, setRevision] = useState(0);
  // The reader re-renders constantly; keep the identity of the open document
  // tied to the book, not to the object the parent happens to pass down.
  const key = book ? (book.id ?? book.title) : null;
  const hasPdf = !!book && !!(book.pdfFileName || book.pdfUrl || book.pdfStorageOption);
  const titleRef = useRef<string | undefined>(book?.title);
  titleRef.current = book?.title;
  const idRef = useRef<string | undefined>(book?.id);
  idRef.current = book?.id;
  const fileNameRef = useRef<string | undefined>(book?.pdfFileName);
  fileNameRef.current = book?.pdfFileName;
  const urlRef = useRef<string | undefined>(book?.pdfUrl);
  urlRef.current = book?.pdfUrl;

  useEffect(() => {
    if (!enabled || !key || !hasPdf) {
      setSource(null);
      return;
    }
    const itemId = idRef.current;
    const next = createPdfTextSource({
      key,
      fileName: fileNameRef.current,
      engine: pdfEngine,
      /**
       * Text recognition for a PDF with no text layer (Phase 10.4).
       *
       * Constructed per book but inert until needed: the shared core only
       * reaches for it after a full text pass has found nothing anywhere,
       * and nothing is loaded until then — Tesseract's WebAssembly arrives
       * on first use, not with the bundle.
       */
      ocr: createPdfOcr(),
      store,
      remote: itemId && isApiConfigured ? createPdfTextRemote(api.pdfText, itemId) : undefined,
      bytes: async () => {
        // The blob vault is the normal case; a URL is the fallback for books
        // whose PDF lives somewhere reachable.
        const blob = await getPdfBlobByAnyKey([itemId, titleRef.current]);
        if (blob) return blob.arrayBuffer();
        const url = urlRef.current;
        if (!url) return null;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          return await res.arrayBuffer();
        } catch {
          return null;
        }
      },
      onChange: () => setRevision((r) => r + 1),
    });
    setSource(next);
    setRevision((r) => r + 1);
    return () => {
      next.dispose();
    };
  }, [key, hasPdf, enabled]);

  return { source, revision };
}
