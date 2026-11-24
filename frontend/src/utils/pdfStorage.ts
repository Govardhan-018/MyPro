/**
 * MyPro IndexedDB & Supabase Storage Utility
 * Manages privacy-conscious local storage in browser IndexedDB
 * and handles encrypted cross-device cloud sync with Supabase.
 */

const DB_NAME = "mypro_storage_vault";
// v2 adds the extracted-text store (Phase 10.1) alongside the PDF blobs.
// v3 adds the offline-download records (what was saved for offline reading).
const DB_VERSION = 3;
const STORE_NAME = "pdf_documents";
const TEXT_STORE_NAME = "pdf_text";
const OFFLINE_STORE_NAME = "offline_books";

export interface StoredPdfRecord {
  id: string; // book title or unique identifier
  fileName: string;
  blob?: Blob;
  sizeBytes: number;
  uploadedAt: string;
  storageType: "device" | "sync";
}

/** Open or initialize the MyPro IndexedDB vault */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported in this browser"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(TEXT_STORE_NAME)) {
        db.createObjectStore(TEXT_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
        db.createObjectStore(OFFLINE_STORE_NAME, { keyPath: "id" });
      }
    };
    // Another tab still holds the old version open: let it close, don't hang.
    request.onblocked = () => reject(new Error("Storage is busy in another tab — close it and retry."));

    request.onsuccess = () => {
      const db = request.result;
      // A newer version opened elsewhere (a fresh deploy in another tab):
      // step aside so its upgrade is not blocked by this old connection.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Stores a PDF file locally in IndexedDB without uploading to Supabase.
 * Enables full offline reading.
 */
export async function storePdfLocally(
  bookId: string,
  file: File | Blob,
  fileName: string,
): Promise<StoredPdfRecord> {
  const db = await openDb();
  const record: StoredPdfRecord = {
    id: bookId,
    fileName,
    blob: file,
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
    storageType: "device",
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves a locally stored PDF from IndexedDB.
 */
export async function getPdfLocally(bookId: string): Promise<StoredPdfRecord | null> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(bookId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/**
 * Deletes a PDF record from IndexedDB.
 */
export async function deletePdfLocally(bookId: string): Promise<void> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(bookId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Graceful fallback
  }
}

/**
 * Calculates current total storage usage in IndexedDB.
 */
export async function getLocalDbUsage(): Promise<{ totalBytes: number; count: number }> {
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const records: StoredPdfRecord[] = request.result || [];
        const totalBytes = records.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
        resolve({ totalBytes, count: records.length });
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return { totalBytes: 0, count: 0 };
  }
}

/**
 * Helper to format byte counts into clean human-readable text.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Thrown while cloud storage for PDF files does not exist on the server. */
export class CloudSyncUnavailableError extends Error {
  constructor() {
    super(
      "Cloud storage for PDF files isn’t available yet, so this book stays on this device. " +
        "Your reading progress and highlights still sync.",
    );
    this.name = "CloudSyncUnavailableError";
  }
}

/**
 * Upload a PDF to cloud storage.
 *
 * There is no PDF-file storage endpoint on the server yet (only the extracted
 * text is cached). This used to *simulate* an upload — a progress bar and a
 * made-up URL — after which "Move to cloud" deleted the only real copy on the
 * device. It now refuses honestly, so callers keep the local file.
 */
export async function performSupabaseUpload(
  _fileName: string,
  _totalBytes: number,
  _onProgress: (percent: number, uploadedBytes: number) => void,
): Promise<{ success: boolean; url: string }> {
  throw new CloudSyncUnavailableError();
}

// ---------------------------------------------------------------------------
// Extracted text (Phase 10.1) — the reader's cache
// ---------------------------------------------------------------------------

/**
 * The blob vault is keyed by whatever identifier the importer had to hand:
 * `BookOptionsModal` has always used the book's title, while newer code uses
 * the library item id. Try each in turn so books imported before the id was
 * available keep opening.
 */
export async function getPdfBlobByAnyKey(keys: (string | undefined)[]): Promise<Blob | null> {
  for (const key of keys) {
    if (!key) continue;
    const record = await getPdfLocally(key);
    if (record?.blob) return record.blob;
  }
  return null;
}

/** The extracted-text JSON for a book, as cached on this device. */
export async function loadExtractedText<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(TEXT_STORE_NAME, "readonly");
      const request = tx.objectStore(TEXT_STORE_NAME).get(key);
      request.onsuccess = () => {
        const row = request.result as { doc?: T } | undefined;
        resolve(row?.doc ?? null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/** Cache extracted text so re-opening a book is instant and offline-safe. */
export async function saveExtractedText(key: string, doc: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TEXT_STORE_NAME, "readwrite");
      const request = tx
        .objectStore(TEXT_STORE_NAME)
        .put({ id: key, doc, savedAt: new Date().toISOString() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // A full or unavailable vault must never break reading.
  }
}

/** Forget a book's extracted text (re-import, or freeing space). */
export async function deleteExtractedText(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(TEXT_STORE_NAME, "readwrite");
      const request = tx.objectStore(TEXT_STORE_NAME).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  } catch {
    // Graceful fallback
  }
}

/* ------------------------------------------------------------------ */
/* Offline downloads — which books were saved for offline reading.      */
/* The book text itself lives in the pdf_text store (same key the       */
/* reader opens), so a download is exactly what the reader reads.       */
/* ------------------------------------------------------------------ */

export interface OfflineBookRecord {
  /** Library item id (or title for an unsaved book). */
  id: string;
  /** The pdf_text key holding the book's structured text. */
  textKey: string;
  title: string;
  creator?: string;
  cover?: string;
  pageCount: number;
  chapters: number;
  /** The text's own version (its extraction time) — re-downloads compare it. */
  version: string;
  sizeBytes: number;
  savedAt: string;
}

async function offlineTx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, mode);
    const request = run(tx.objectStore(OFFLINE_STORE_NAME));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

export async function listOfflineBooks(): Promise<OfflineBookRecord[]> {
  try {
    return (await offlineTx<OfflineBookRecord[]>("readonly", (s) => s.getAll())) ?? [];
  } catch {
    return [];
  }
}

export async function saveOfflineBook(record: OfflineBookRecord): Promise<void> {
  await offlineTx("readwrite", (s) => s.put(record));
}

export async function deleteOfflineBook(id: string): Promise<void> {
  try {
    await offlineTx("readwrite", (s) => s.delete(id));
  } catch {
    /* already gone */
  }
}
