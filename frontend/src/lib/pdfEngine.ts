/**
 * The web half of Phase 10.1: pdfjs-dist, wrapped in the platform-free
 * {@link PdfEngine} seam from `@mypro/shared`. This is the only module in the
 * app that imports pdfjs, so the reader stays engine-agnostic.
 *
 * Extraction is text-only — no canvas, no rendering — so it is cheap enough to
 * run on the main thread's idle time while the worker does the parsing.
 */
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type {
  PdfDocInfo,
  PdfEngine,
  PdfHandle,
  PdfOutlineNode,
  PdfPageImage,
  PdfTextItem,
} from "@mypro/shared";

type Pdfjs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<Pdfjs> | null = null;

/**
 * pdfjs is about a megabyte, and most sessions never open a book — so it is
 * loaded on first use rather than bundled into the entry chunk. Vite serves
 * the worker as its own hashed asset; nothing is fetched from a CDN.
 */
function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return pdfjsPromise;
}

/** pdfjs text items carry `str`; marked-content items don't. */
function isTextItem(item: TextItem | { type: string }): item is TextItem {
  return typeof (item as TextItem).str === "string";
}

type PdfjsDocument = Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;


/** Resolve an outline destination to a 1-based page number. */
async function destinationPage(doc: PdfjsDocument, dest: unknown): Promise<number | null> {
  try {
    const resolved = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(resolved) || !resolved.length) return null;
    const index = await doc.getPageIndex(resolved[0] as never);
    return typeof index === "number" ? index + 1 : null;
  } catch {
    return null;
  }
}

interface RawOutlineItem {
  title: string;
  dest: unknown;
  items?: RawOutlineItem[];
}

async function toOutlineNodes(
  doc: PdfjsDocument,
  items: RawOutlineItem[],
): Promise<PdfOutlineNode[]> {
  const nodes: PdfOutlineNode[] = [];
  for (const item of items) {
    nodes.push({
      title: item.title ?? "",
      page: await destinationPage(doc, item.dest),
      children: item.items?.length ? await toOutlineNodes(doc, item.items) : undefined,
    });
  }
  return nodes;
}

export const pdfEngine: PdfEngine = {
  async open(bytes: ArrayBuffer): Promise<PdfHandle> {
    const pdfjs = await loadPdfjs();
    // Personal documents, but there is still no reason to let a PDF pull
    // anything in: extraction needs the bytes we already have and nothing else.
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableAutoFetch: true,
    });
    const doc = await task.promise;

    return {
      pageCount: doc.numPages,

      async textItems(pageNumber: number): Promise<PdfTextItem[]> {
        const page = await doc.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          // `fontName` is an internal id ("g_d0_f2"); the real family is in
          // the styles map. Embedded fonts keep their name there, which is
          // what makes weight detectable.
          const styles = (content.styles ?? {}) as Record<string, { fontFamily?: string }>;
          return content.items.filter(isTextItem).map((item) => ({
            text: item.str,
            // transform = [a, b, c, d, e, f]; e/f are the device-space origin.
            x: item.transform[4] ?? 0,
            y: item.transform[5] ?? 0,
            width: item.width ?? 0,
            height: item.height || Math.abs(item.transform[3] ?? 0) || 10,
            eol: item.hasEOL,
            // The font name is how weight is detectable ("...-Bold"), which
            // the block pass uses to spot run-in headings.
            font: styles[item.fontName]?.fontFamily ?? item.fontName,
          }));
        } finally {
          // Text extraction holds no render resources, but pdfjs still caches
          // the page's operator list until it is told to let go.
          page.cleanup();
        }
      },

      /**
       * Rasterise a page for OCR (Phase 10.4).
       *
       * The only place this module draws anything. Extraction is text-only,
       * but a scanned PDF has no text to extract — there is nothing to read
       * but the picture, so it has to be rendered before it can be
       * recognised.
       *
       * PNG rather than JPEG: Tesseract reads edges, and JPEG's ringing
       * around glyph boundaries measurably costs accuracy on body text at
       * this scale. Returns null rather than throwing, so one unrenderable
       * page does not abort the pass.
       */
      async renderPage(pageNumber: number, scale = 2): Promise<PdfPageImage | null> {
        const page = await doc.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale });
          const width = Math.max(1, Math.floor(viewport.width));
          const height = Math.max(1, Math.floor(viewport.height));

          // OffscreenCanvas keeps the work off the layout path; a detached
          // <canvas> is the fallback for browsers without it.
          const canvas: OffscreenCanvas | HTMLCanvasElement =
            typeof OffscreenCanvas === "function"
              ? new OffscreenCanvas(width, height)
              : Object.assign(document.createElement("canvas"), { width, height });

          const context = canvas.getContext("2d") as
            | OffscreenCanvasRenderingContext2D
            | CanvasRenderingContext2D
            | null;
          if (!context) return null;

          // A scan rendered onto a transparent canvas gives Tesseract black
          // text on nothing; it needs a white page under it.
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, width, height);

          await page.render({
            canvas: canvas as HTMLCanvasElement,
            canvasContext: context as CanvasRenderingContext2D,
            viewport,
          }).promise;

          const bytes = await canvasToPng(canvas);
          if (!bytes) return null;

          return { page: pageNumber, bytes, mimeType: "image/png", width, height };
        } catch {
          return null;
        } finally {
          // Rendering *does* hold resources, unlike text extraction.
          page.cleanup();
        }
      },

      async outline(): Promise<PdfOutlineNode[]> {
        const raw = (await doc.getOutline()) as RawOutlineItem[] | null;
        if (!raw?.length) return [];
        return toOutlineNodes(doc, raw);
      },

      async info(): Promise<PdfDocInfo> {
        const meta = (await doc.getMetadata()) as {
          info?: Record<string, unknown>;
        };
        const raw = meta.info ?? {};
        const str = (key: string): string | undefined => {
          const value = raw[key];
          return typeof value === "string" && value.trim() ? value.trim() : undefined;
        };
        // PDF dates look like D:20240115103000+01'00' — keep the readable part.
        const date = (key: string): string | undefined => {
          const value = str(key);
          if (!value) return undefined;
          const match = value.match(/^D:(\d{4})(\d{2})?(\d{2})?/);
          if (!match) return value;
          const [, year, month = "01", day = "01"] = match;
          return `${year}-${month}-${day}`;
        };

        let pageSize: PdfDocInfo["pageSize"];
        try {
          const first = await doc.getPage(1);
          const [, , width, height] = first.view as number[];
          pageSize = { width: Math.round(width), height: Math.round(height) };
          first.cleanup();
        } catch {
          /* a size is a nicety, not a requirement */
        }

        return {
          title: str("Title"),
          author: str("Author"),
          subject: str("Subject"),
          keywords: str("Keywords"),
          creator: str("Creator"),
          producer: str("Producer"),
          created: date("CreationDate"),
          modified: date("ModDate"),
          pageSize,
        };
      },

      close() {
        // Tearing down the loading task also shuts the worker down.
        void task.destroy();
      },
    };
  },
};

/** The real page count of a PDF, for the import flow (0 if unreadable). */
export async function readPageCount(bytes: ArrayBuffer): Promise<number> {
  try {
    const handle = await pdfEngine.open(bytes);
    const { pageCount } = handle;
    await handle.close?.();
    return pageCount;
  } catch {
    return 0;
  }
}

/**
 * PNG bytes from either canvas flavour.
 *
 * `OffscreenCanvas` gives a Blob from a promise; a DOM canvas gives one
 * through a callback. Both end up as an ArrayBuffer, which is what crosses
 * into the OCR worker.
 */
async function canvasToPng(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): Promise<ArrayBuffer | null> {
  try {
    if ("convertToBlob" in canvas) {
      const blob = await canvas.convertToBlob({ type: "image/png" });
      return await blob.arrayBuffer();
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/png"),
    );
    return blob ? await blob.arrayBuffer() : null;
  } catch {
    return null;
  }
}
