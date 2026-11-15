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
  PdfEngine,
  PdfHandle,
  PdfOutlineNode,
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
          return content.items.filter(isTextItem).map((item) => ({
            text: item.str,
            // transform = [a, b, c, d, e, f]; e/f are the device-space origin.
            x: item.transform[4] ?? 0,
            y: item.transform[5] ?? 0,
            width: item.width ?? 0,
            height: item.height || Math.abs(item.transform[3] ?? 0) || 10,
            eol: item.hasEOL,
          }));
        } finally {
          // Text extraction holds no render resources, but pdfjs still caches
          // the page's operator list until it is told to let go.
          page.cleanup();
        }
      },

      async outline(): Promise<PdfOutlineNode[]> {
        const raw = (await doc.getOutline()) as RawOutlineItem[] | null;
        if (!raw?.length) return [];
        return toOutlineNodes(doc, raw);
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
