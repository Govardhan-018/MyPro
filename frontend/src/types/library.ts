export type BookmarkItem = {
  id: string;
  page: number;
  title: string;
  createdAt: string;
};

export type NoteItem = {
  id: string;
  page: number;
  text: string;
  createdAt: string;
};

export type HighlightItem = {
  id: string;
  page: number;
  text: string;
  color: "lavender" | "cyan" | "mint" | "peach" | "monochrome";
};

export type AnnotationKind = "note" | "quote" | "summary" | "question" | "highlight";

export type AnnotationColor = "lavender" | "cyan" | "mint" | "coral" | "yellow";

/**
 * A single reader annotation. Anchored to a logical location (page +
 * paragraph index + the original passage text) rather than pixel
 * coordinates, so markers stay attached across font-size, zoom, and
 * reading-mode changes.
 */
export type Annotation = {
  id: string;
  kind: AnnotationKind;
  page: number;
  paragraph: number;
  anchorText: string;
  title?: string;
  body?: string;
  color?: AnnotationColor;
  tags?: string[];
  chapter?: string;
  createdAt: string;
};

export type TocChapter = {
  id: string;
  title: string;
  part?: string;
  page: number;
  preview?: string;
};

export type ReaderTheme = "dark" | "sepia" | "original";

export type LibraryItem = {
  id?: string;
  title: string;
  creator: string;
  type: "Books" | "Podcasts" | "Articles" | "Notes" | string;
  status: "In Progress" | "Completed" | "Want to Read" | "Favorites" | string;
  progress: number; // 0-100 percentage
  accessed: string;
  tone: string;
  image: string;
  // Book specific properties
  currentPage?: number;
  totalPages?: number;
  pdfUrl?: string;
  pdfFileName?: string;
  pdfStorageOption?: "device" | "sync";
  syncStatus?: "local" | "synced" | "uploading" | "pending";
  fileSizeBytes?: number;
  fileSizeFormatted?: string;
  uploadProgress?: number;
  lastSyncedAt?: string;
  indexedDbKey?: string;
  lastReadDate?: string;
  bookmarks?: BookmarkItem[];
  notes?: NoteItem[];
  highlights?: HighlightItem[];
  annotations?: Annotation[];
  toc?: TocChapter[];
  // Podcast specific properties
  youtubeUrl?: string;
  episodeTitle?: string;
  podcastName?: string;
  currentTimeSeconds?: number;
  durationSeconds?: number;
  playbackSpeed?: number;
  description?: string;
  // Article specific properties
  readTimeMinutes?: number;
  articleContent?: string;
};
