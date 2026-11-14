/**
 * Translation between the rich in-UI `LibraryItem` model and the generic
 * `library_items` row (+ its per-type detail table) the API speaks. The UI is
 * intentionally richer; this is the one place the two shapes meet.
 */
import type { LibraryItem } from '../types/library';
import type { LibraryItemRow, LibraryType } from './api';

type ApiStatus = 'in_progress' | 'completed' | 'want' | 'favorite';

const TYPE_TO_UI: Record<LibraryType, LibraryItem['type']> = {
  book: 'Books',
  podcast: 'Podcasts',
  article: 'Articles',
  note: 'Notes',
};
const UI_TO_TYPE: Record<string, LibraryType> = {
  Books: 'book',
  Podcasts: 'podcast',
  Articles: 'article',
  Notes: 'note',
};
const STATUS_TO_UI: Record<ApiStatus, LibraryItem['status']> = {
  in_progress: 'In Progress',
  completed: 'Completed',
  want: 'Want to Read',
  favorite: 'Favorites',
};
const UI_TO_STATUS: Record<string, ApiStatus> = {
  'In Progress': 'in_progress',
  Completed: 'completed',
  'Want to Read': 'want',
  Favorites: 'favorite',
};

/** Supabase returns a to-one embed as either an object or a 1-element array. */
function firstDetail(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return (raw[0] as Record<string, unknown>) ?? null;
  return raw as Record<string, unknown>;
}

/** Drop undefined keys; return undefined when nothing is left. */
function clean(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== '' && v !== null) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function humanAccessed(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.floor((startOfToday - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / dayMs);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** API row → the UI's LibraryItem. */
export function rowToItem(row: LibraryItemRow): LibraryItem {
  const type = TYPE_TO_UI[row.type] ?? 'Books';
  const item: LibraryItem = {
    id: row.id,
    title: row.title,
    creator: row.creator ?? '',
    type,
    status: STATUS_TO_UI[(row.status as ApiStatus) ?? 'want'] ?? 'Want to Read',
    progress: row.progress ?? 0,
    accessed: humanAccessed(row.accessed_at),
    tone: row.tone ?? 'lavender',
    image: row.cover_url ?? '',
  };

  const book = firstDetail(row.book_details);
  if (type === 'Books' && book) {
    item.totalPages = num(book.total_pages);
    item.currentPage = num(book.current_page);
    item.pdfFileName = str(book.pdf_filename);
    item.pdfStorageOption = str(book.pdf_storage) as LibraryItem['pdfStorageOption'];
    item.syncStatus = str(book.sync_status) as LibraryItem['syncStatus'];
    item.fileSizeBytes = num(book.file_size_bytes);
  }

  const pod = firstDetail(row.podcast_details);
  if (type === 'Podcasts' && pod) {
    item.youtubeUrl = str(pod.youtube_url);
    item.podcastName = str(pod.channel);
    item.episodeTitle = str(pod.episode_title);
    item.durationSeconds = num(pod.duration_seconds);
    item.currentTimeSeconds = num(pod.current_time_seconds);
    item.playbackSpeed = num(pod.playback_speed);
  }

  const art = firstDetail(row.article_details);
  if (type === 'Articles' && art) {
    item.readTimeMinutes = num(art.read_time_minutes);
    item.pdfUrl = str(art.source_url);
  }

  const note = firstDetail(row.note_details);
  if (type === 'Notes' && note) {
    item.articleContent = str(note.body);
  }

  return item;
}

function detailsForItem(type: LibraryType, item: LibraryItem): Record<string, unknown> | undefined {
  if (type === 'book') {
    return clean({
      total_pages: item.totalPages,
      current_page: item.currentPage,
      pdf_filename: item.pdfFileName,
      pdf_storage: item.pdfStorageOption,
      sync_status: item.syncStatus,
      file_size_bytes: item.fileSizeBytes,
    });
  }
  if (type === 'podcast') {
    return clean({
      youtube_url: item.youtubeUrl,
      channel: item.podcastName,
      episode_title: item.episodeTitle,
      duration_seconds: item.durationSeconds,
      current_time_seconds: item.currentTimeSeconds,
      playback_speed: item.playbackSpeed,
    });
  }
  if (type === 'article') {
    return clean({ read_time_minutes: item.readTimeMinutes, source_url: item.pdfUrl });
  }
  if (type === 'note') {
    return clean({ body: item.articleContent });
  }
  return undefined;
}

/** LibraryItem → POST /library body. */
export function itemToCreateBody(item: LibraryItem) {
  const type = UI_TO_TYPE[item.type] ?? 'book';
  return {
    type,
    title: item.title,
    creator: item.creator || undefined,
    status: UI_TO_STATUS[item.status] ?? ('want' as ApiStatus),
    progress: Math.max(0, Math.min(100, Math.round(item.progress ?? 0))),
    cover_url: item.image || undefined,
    tone: item.tone || undefined,
    details: detailsForItem(type, item),
  };
}

/** LibraryItem → PATCH /library/:id body (type is immutable server-side). */
export function itemToPatchBody(item: LibraryItem): Record<string, unknown> {
  const type = UI_TO_TYPE[item.type] ?? 'book';
  return clean({
    title: item.title,
    creator: item.creator || undefined,
    status: UI_TO_STATUS[item.status] ?? 'want',
    progress: Math.max(0, Math.min(100, Math.round(item.progress ?? 0))),
    cover_url: item.image || undefined,
    tone: item.tone || undefined,
    details: detailsForItem(type, item),
  }) ?? {};
}
