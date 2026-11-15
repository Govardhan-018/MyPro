/**
 * Text recognition for scanned PDFs — Phase 10.4, the web half.
 *
 * The {@link PdfOcr} seam in `@mypro/shared` decides *when* to recognise; this
 * is *how*, on this device. Tesseract compiled to WebAssembly runs in a worker
 * in the browser, so a scanned book is read where it already sits:
 *
 *  - **No API, no key, no per-page cost.** The zero-cost rule holds.
 *  - **The PDF never leaves the device.** That promise is the whole point of
 *    the local-first pipeline, and sending page images to a cloud OCR service
 *    would quietly break it for exactly the most private documents — the
 *    scans.
 *
 * Android gets no implementation: it has no renderer to rasterise pages with,
 * so a scanned book there still reports `scanned` and says to open it once in
 * the web app. That is the same shape as the extraction split already in
 * place.
 */
import type { PdfOcr, PdfPageImage } from "@mypro/shared";

type Tesseract = typeof import("tesseract.js");
type Worker = Awaited<ReturnType<Tesseract["createWorker"]>>;

const read = (key: string): string =>
  ((import.meta.env as Record<string, string | undefined>)[key] ?? "").trim();

/**
 * Where the recogniser's own assets come from.
 *
 * The worker script is served from our own origin — Vite emits it as a hashed
 * asset from the installed package, so no URL is written down here. The core
 * WebAssembly and the language data are left to the library's own defaults
 * unless these are set, which keeps third-party URLs out of this repo while
 * still allowing them to be pinned or self-hosted later:
 *
 *   VITE_OCR_CORE_PATH   a directory serving tesseract-core*.wasm.js
 *   VITE_OCR_LANG_PATH   a directory serving <lang>.traineddata.gz
 *   VITE_OCR_LANGUAGE    defaults to 'eng'
 *
 * Note the language data (a few megabytes) is fetched once on first use and
 * then cached by the browser, so the second scanned book costs nothing.
 */
const LANGUAGE = read("VITE_OCR_LANGUAGE") || "eng";

/**
 * Tesseract is tens of megabytes of WebAssembly. Loading it on first use —
 * which for most people is never — keeps it out of the entry chunk, exactly
 * as pdfjs is handled.
 */
let tesseractPromise: Promise<Tesseract> | null = null;

function loadTesseract(): Promise<Tesseract> {
  tesseractPromise ??= import("tesseract.js");
  return tesseractPromise;
}

/**
 * A recogniser for one book.
 *
 * One worker per book, created on the first page and torn down by the shared
 * core when the pass ends: spawning a worker per page would spend more time
 * starting up than reading, and keeping one alive forever would hold its
 * memory for a session that may never open another scan.
 */
export function createPdfOcr(): PdfOcr {
  let workerPromise: Promise<Worker> | null = null;
  let disposed = false;

  const worker = async (): Promise<Worker> => {
    workerPromise ??= (async () => {
      const tesseract = await loadTesseract();
      // Served from our own origin rather than a CDN.
      const workerUrl = (await import("tesseract.js/dist/worker.min.js?url")).default;

      const corePath = read("VITE_OCR_CORE_PATH");
      const langPath = read("VITE_OCR_LANG_PATH");

      return tesseract.createWorker(LANGUAGE, undefined, {
        workerPath: workerUrl,
        // Omitted rather than passed empty: the library treats an empty
        // string as a real path and fetches from the wrong place.
        ...(corePath ? { corePath } : {}),
        ...(langPath ? { langPath } : {}),
      });
    })();
    return workerPromise;
  };

  return {
    async recognize(image: PdfPageImage): Promise<string> {
      if (disposed) return "";
      const instance = await worker();
      if (disposed) return "";

      // Tesseract takes a Blob directly; no data-URL round trip, which for a
      // 2×-scaled page image would be a megabyte of base64 per page.
      const blob = new Blob([image.bytes], { type: image.mimeType });
      const { data } = await instance.recognize(blob);
      return data.text ?? "";
    },

    async dispose(): Promise<void> {
      disposed = true;
      const pending = workerPromise;
      workerPromise = null;
      if (!pending) return;
      try {
        await (await pending).terminate();
      } catch {
        /* the worker may already be gone; nothing useful to do */
      }
    },
  };
}
