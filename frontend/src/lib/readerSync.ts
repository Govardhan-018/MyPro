import { useCallback, useMemo, useRef } from 'react';
import type { Annotation, AnnotationColor, BookmarkItem } from '../types/library';
import { api, type AnnotationRow } from './api';

/**
 * Reader persistence. The reader works on in-memory annotation/bookmark arrays
 * and auto-saves a full snapshot on every change. Rather than round-trip server
 * ids back into the reader mid-session, we:
 *   - load the saved annotations/bookmarks when a book opens, and
 *   - reconcile the final snapshot against that loaded state when it closes
 *     (create the new ones, delete the removed ones) + record a reading session.
 * Each open reloads from the server, so ids never need to flow backwards.
 */

const UI_COLORS = new Set<AnnotationColor>(['lavender', 'cyan', 'mint', 'coral', 'yellow']);
const KIND_COLOR: Record<Annotation['kind'], AnnotationColor> = {
  note: 'lavender',
  quote: 'cyan',
  summary: 'mint',
  question: 'coral',
  highlight: 'yellow',
};

function uiColor(color: string | null | undefined, kind: Annotation['kind']): AnnotationColor {
  if (color && UI_COLORS.has(color as AnnotationColor)) return color as AnnotationColor;
  return KIND_COLOR[kind] ?? 'lavender';
}

export function annotationRowToUi(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    kind: row.kind,
    page: row.page ?? 0,
    paragraph: row.paragraph ?? 0,
    anchorText: row.anchor_text ?? '',
    title: row.title ?? undefined,
    body: row.body ?? undefined,
    color: uiColor(row.color, row.kind),
    chapter: row.chapter ?? undefined,
    createdAt: row.created_at,
  };
}

export function bookmarkRowToUi(row: Record<string, unknown>): BookmarkItem {
  return {
    id: String(row.id),
    page: typeof row.page === 'number' ? row.page : 0,
    title: typeof row.title === 'string' ? row.title : '',
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

function annotationToCreate(a: Annotation) {
  return {
    kind: a.kind,
    page: a.page,
    paragraph: a.paragraph,
    anchor_text: a.anchorText || undefined,
    title: a.title || undefined,
    body: a.body || undefined,
    color: a.color || undefined,
    chapter: a.chapter || undefined,
    tags: a.tags && a.tags.length ? a.tags : undefined,
  };
}

export interface ReaderSnapshot {
  bookmarks: BookmarkItem[];
  annotations: Annotation[];
  currentPage: number;
  totalPages: number;
}

interface ServerState {
  itemId: string;
  annotationIds: Set<string>;
  bookmarkIdByPage: Map<number, string>;
}

export interface ReaderSync {
  /** Mark a reading session started for an item (resets tracked state). */
  begin: (itemId: string) => void;
  /** Record the loaded server annotations/bookmarks for later diffing. */
  setServer: (itemId: string, annotations: AnnotationRow[], bookmarks: Record<string, unknown>[]) => void;
  /** Stash the reader's latest snapshot (overwrites). */
  snapshot: (snap: ReaderSnapshot) => void;
  /** Reconcile the final snapshot to the server and log the session. */
  flush: (itemId: string) => void;
}

export function useReaderSync(configured: boolean): ReaderSync {
  const server = useRef<ServerState | null>(null);
  const snap = useRef<ReaderSnapshot | null>(null);
  const startedAt = useRef<string>('');

  const begin = useCallback((itemId: string) => {
    startedAt.current = new Date().toISOString();
    server.current = { itemId, annotationIds: new Set(), bookmarkIdByPage: new Map() };
    snap.current = null;
  }, []);

  const setServer = useCallback(
    (itemId: string, annotations: AnnotationRow[], bookmarks: Record<string, unknown>[]) => {
      if (!server.current || server.current.itemId !== itemId) return;
      server.current.annotationIds = new Set(annotations.map((a) => a.id));
      server.current.bookmarkIdByPage = new Map(
        bookmarks.map((b) => [typeof b.page === 'number' ? b.page : -1, String(b.id)]),
      );
    },
    [],
  );

  const snapshot = useCallback((next: ReaderSnapshot) => {
    snap.current = next;
  }, []);

  const flush = useCallback(
    (itemId: string) => {
      const state = server.current;
      const latest = snap.current;
      const started = startedAt.current;
      server.current = null;
      snap.current = null;
      if (!configured || !state || state.itemId !== itemId) return;

      if (latest) {
        const currentAnnotationIds = new Set(latest.annotations.map((a) => a.id));
        for (const id of state.annotationIds) {
          if (!currentAnnotationIds.has(id)) api.reader.deleteAnnotation(id).catch(() => {});
        }
        for (const a of latest.annotations) {
          if (!state.annotationIds.has(a.id)) {
            api.reader.createAnnotation(itemId, annotationToCreate(a)).catch(() => {});
          }
        }

        const currentPages = new Set(latest.bookmarks.map((b) => b.page));
        for (const [page, id] of state.bookmarkIdByPage) {
          if (!currentPages.has(page)) api.reader.deleteBookmark(id).catch(() => {});
        }
        for (const b of latest.bookmarks) {
          if (!state.bookmarkIdByPage.has(b.page)) {
            api.reader
              .createBookmark(itemId, { page: b.page, title: b.title || undefined })
              .catch(() => {});
          }
        }
      }

      api.reader
        .readingSession(itemId, {
          started_at: started || new Date().toISOString(),
          ended_at: new Date().toISOString(),
          ...(latest ? { end_page: latest.currentPage } : {}),
        })
        .catch(() => {});
    },
    [configured],
  );

  return useMemo(
    () => ({ begin, setServer, snapshot, flush }),
    [begin, setServer, snapshot, flush],
  );
}
