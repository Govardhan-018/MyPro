/**
 * The cloud half of Phase 10.2: the extracted-text JSON in Supabase Storage,
 * reached through Render-brokered signed URLs so no client ever holds a
 * Supabase key. Platform-free — `fetch` is injected (it is global on both web
 * and React Native anyway).
 */
import type { PdfTextDoc, PdfTextRemote } from './pdf';
import { isPdfTextDoc } from './pdf';

/** Just the slice of the API client this needs — keeps the import one-way. */
export interface PdfTextApi {
  uploadUrl(itemId: string): Promise<{ url: string; path: string }>;
  downloadUrl(itemId: string): Promise<{ url: string | null; path: string | null }>;
  confirm(
    itemId: string,
    body: { path: string; page_count: number; scanned?: boolean },
  ): Promise<unknown>;
}

export function createPdfTextRemote(
  api: PdfTextApi,
  itemId: string,
  fetchImpl?: typeof fetch,
): PdfTextRemote {
  const doFetch: typeof fetch = fetchImpl ?? ((...args) => fetch(...args));

  return {
    async load(): Promise<PdfTextDoc | null> {
      const { url } = await api.downloadUrl(itemId);
      if (!url) return null;
      const res = await doFetch(url);
      if (!res.ok) return null;
      const parsed: unknown = await res.json();
      return isPdfTextDoc(parsed) ? parsed : null;
    },

    async save(doc: PdfTextDoc): Promise<void> {
      const { url, path } = await api.uploadUrl(itemId);
      const res = await doFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' },
        body: JSON.stringify(doc),
      });
      if (!res.ok) throw new Error(`Could not upload extracted text (${res.status})`);
      await api.confirm(itemId, {
        path,
        page_count: doc.pageCount,
        scanned: doc.scanned,
      });
    },
  };
}
