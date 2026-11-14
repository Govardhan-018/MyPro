import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';

export type KnowledgeKind = 'Note' | 'Highlight' | 'Quote' | 'Summary' | 'Question' | 'Bookmark';

export interface KnowledgeEntry {
  id: string;
  kind: KnowledgeKind;
  text: string;
  heading?: string;
  bookTitle: string;
  page: number;
  date: string;
  tone: string;
  tags: string[];
}

const COLOR_TONE: Record<string, string> = {
  lavender: 'lavender',
  cyan: 'cyan',
  mint: 'mint',
  coral: 'peach',
  yellow: 'lavender',
  peach: 'peach',
  monochrome: 'lavender',
};

function capitalize(value: string): KnowledgeKind {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as KnowledgeKind;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function numOr0(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/** Supabase embeds library_items as an object (to-one) or a 1-element array. */
function bookTitle(row: Record<string, unknown>): string {
  const ref = row.library_items;
  if (!ref) return '';
  const obj = Array.isArray(ref) ? ref[0] : ref;
  return str((obj as Record<string, unknown> | undefined)?.title) ?? '';
}

function annotationToEntry(a: Record<string, unknown>): KnowledgeEntry {
  const kind = str(a.kind) ?? 'note';
  return {
    id: `an-${String(a.id)}`,
    kind: capitalize(kind),
    text: str(a.body) || str(a.anchor_text) || '',
    heading: str(a.title),
    bookTitle: bookTitle(a),
    page: numOr0(a.page),
    date: str(a.created_at) ?? '',
    tone: COLOR_TONE[str(a.color) ?? ''] ?? 'lavender',
    tags: [kind],
  };
}

function bookmarkToEntry(b: Record<string, unknown>): KnowledgeEntry {
  const page = numOr0(b.page);
  return {
    id: `bm-${String(b.id)}`,
    kind: 'Bookmark',
    text: str(b.title) || `Page ${page}`,
    bookTitle: bookTitle(b),
    page,
    date: str(b.created_at) ?? '',
    tone: 'lavender',
    tags: ['bookmark'],
  };
}

/** The real database id + kind behind a {@link KnowledgeEntry}, for deletion. */
export function entrySource(id: string): { kind: 'annotation' | 'bookmark'; id: string } | null {
  if (id.startsWith('an-')) return { kind: 'annotation', id: id.slice(3) };
  if (id.startsWith('bm-')) return { kind: 'bookmark', id: id.slice(3) };
  return null;
}

export interface KnowledgeState {
  /** Entries from /knowledge, or null when unconfigured (use local derivation). */
  entries: KnowledgeEntry[] | null;
  loading: boolean;
  error: string | null;
  configured: boolean;
}

/** Reads /knowledge (all annotations + bookmarks across the library) server-side. */
export function useKnowledge(): KnowledgeState {
  const configured = isApiConfigured;
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null);
  const [loading, setLoading] = useState<boolean>(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    api.knowledge
      .get()
      .then((data) => {
        if (!active) return;
        const mapped = [
          ...(data.annotations ?? []).map(annotationToEntry),
          ...(data.bookmarks ?? []).map(bookmarkToEntry),
        ];
        setEntries(mapped);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError ? caught.message : 'Could not load your knowledge.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [configured]);

  return { entries, loading, error, configured };
}
