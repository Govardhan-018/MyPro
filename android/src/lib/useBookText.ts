import { useEffect, useState } from 'react';
import {
  createPdfTextRemote,
  createPdfTextSource,
  type PdfTextSource,
} from '@mypro/shared';
import { client } from './client';
import { pdfTextStore } from './pdfTextStore';

/**
 * A book's text on Android: the cached copy if there is one, otherwise the
 * JSON that the extracting device parked in Supabase Storage. No `engine` is
 * passed — this device has no PDF to extract, so a book nobody has extracted
 * yet reports `unavailable` rather than pretending to load forever.
 */
export function useBookText(itemId: string | null): {
  source: PdfTextSource | null;
  revision: number;
} {
  const [source, setSource] = useState<PdfTextSource | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!itemId) {
      setSource(null);
      return;
    }
    const next = createPdfTextSource({
      key: itemId,
      store: pdfTextStore,
      remote: createPdfTextRemote(client.api.pdfText, itemId),
      onChange: () => setRevision((r) => r + 1),
    });
    setSource(next);
    setRevision((r) => r + 1);
    return () => next.dispose();
  }, [itemId]);

  return { source, revision };
}
