/**
 * The annotations and bookmarks this device last knew for a book, so the
 * reader opens with them offline — and so the close-time diff in
 * `readerSync` is computed against them, not against an empty list (which
 * would re-create every note, or lose deletes).
 *
 * Kept per user in localStorage: small (text only) and synchronous, so it is
 * written before the app can be killed.
 */
import type { AnnotationRow } from '@mypro/shared';

export interface ReaderCacheEntry {
  annotations: AnnotationRow[];
  bookmarks: Record<string, unknown>[];
  savedAt: string;
}

function uid(): string | null {
  try {
    const raw = localStorage.getItem('mypro.session');
    return raw ? ((JSON.parse(raw) as { user?: { id?: string } }).user?.id ?? null) : null;
  } catch {
    return null;
  }
}

const key = (user: string, itemId: string) => `mypro.reader.${user}.${itemId}`;

export function readReaderCache(itemId: string): ReaderCacheEntry | null {
  const user = uid();
  if (!user) return null;
  try {
    const raw = localStorage.getItem(key(user, itemId));
    return raw ? (JSON.parse(raw) as ReaderCacheEntry) : null;
  } catch {
    return null;
  }
}

export function writeReaderCache(
  itemId: string,
  annotations: AnnotationRow[],
  bookmarks: Record<string, unknown>[],
): void {
  const user = uid();
  if (!user) return;
  try {
    localStorage.setItem(
      key(user, itemId),
      JSON.stringify({ annotations, bookmarks, savedAt: new Date().toISOString() }),
    );
  } catch {
    /* quota: the server copy is still the record */
  }
}

export function clearReaderCache(itemId: string): void {
  const user = uid();
  if (!user) return;
  try {
    localStorage.removeItem(key(user, itemId));
  } catch {
    /* ignore */
  }
}
