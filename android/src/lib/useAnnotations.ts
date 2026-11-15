/**
 * Reader annotations on the phone — Phase 8.5.
 *
 * The web app's anchoring model ports unchanged, and that is the whole design:
 * an annotation is pinned to a **page plus a paragraph index**, with the
 * passage itself stored alongside as `anchor_text`. Nothing about the anchor
 * depends on font size, zoom, screen width or paged-versus-continuous, so a
 * highlight made on this phone lands on the same sentence in the web reader
 * and survives a re-extraction that reflows every line.
 *
 * `paragraphs` is therefore load-bearing, not legacy: the structured `blocks`
 * array may be regrouped by a better heading heuristic later, but the
 * paragraph indices these anchors point at must not move.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnnotationKind, AnnotationRow } from '@mypro/shared';
import { client } from './client';

export interface Bookmark {
  id: string;
  page: number;
}

export interface AnnotationsState {
  /** Keyed `page:paragraph`, so a paragraph's marks are one lookup away. */
  byAnchor: Map<string, AnnotationRow[]>;
  bookmarks: Bookmark[];
  loading: boolean;
  error: string | null;
  add: (input: {
    kind: AnnotationKind;
    page: number;
    paragraph: number;
    anchorText: string;
    body?: string;
    chapter?: string | null;
  }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggleBookmark: (page: number) => Promise<void>;
  reload: () => void;
}

export const anchorKey = (page: number, paragraph: number): string => `${page}:${paragraph}`;

export function useAnnotations(itemId: string | null): AnnotationsState {
  const [rows, setRows] = useState<AnnotationRow[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!itemId) return;
    setError(null);
    try {
      const [annotations, marks] = await Promise.all([
        client.api.reader.annotations(itemId),
        client.api.reader.bookmarks(itemId).catch(() => [] as Record<string, unknown>[]),
      ]);
      setRows(annotations);
      setBookmarks(
        marks
          .map((row) => ({
            id: String(row.id),
            page: typeof row.page === 'number' ? row.page : 0,
          }))
          .filter((mark) => mark.page > 0),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your marks.');
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const byAnchor = useMemo(() => {
    const map = new Map<string, AnnotationRow[]>();
    for (const row of rows) {
      if (row.page == null || row.paragraph == null) continue;
      const key = anchorKey(row.page, row.paragraph);
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    }
    return map;
  }, [rows]);

  const add = useCallback<AnnotationsState['add']>(
    async (input) => {
      if (!itemId) return;
      try {
        const created = await client.api.reader.createAnnotation(itemId, {
          kind: input.kind,
          page: input.page,
          paragraph: input.paragraph,
          /* Trimmed: the anchor is for recognising the passage later, and a
           * whole page of text in a database column helps nobody. */
          anchor_text: input.anchorText.slice(0, 600),
          body: input.body ?? null,
          chapter: input.chapter ?? null,
        });
        setRows((current) => [created, ...current]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not save that.');
      }
    },
    [itemId],
  );

  const remove = useCallback(async (id: string) => {
    // Optimistic: a mark that lingers after you delete it reads as a bug.
    setRows((current) => current.filter((row) => row.id !== id));
    try {
      await client.api.reader.deleteAnnotation(id);
    } catch {
      void load();
    }
  }, [load]);

  const toggleBookmark = useCallback(
    async (page: number) => {
      if (!itemId) return;
      const existing = bookmarks.find((mark) => mark.page === page);
      try {
        if (existing) {
          setBookmarks((current) => current.filter((mark) => mark.id !== existing.id));
          await client.api.reader.deleteBookmark(existing.id);
        } else {
          await client.api.reader.createBookmark(itemId, { page });
          await load();
        }
      } catch {
        void load();
      }
    },
    [itemId, bookmarks, load],
  );

  return {
    byAnchor,
    bookmarks,
    loading,
    error,
    add,
    remove,
    toggleBookmark,
    reload: () => void load(),
  };
}
