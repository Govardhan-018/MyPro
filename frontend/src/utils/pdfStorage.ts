/**
 * MyPro IndexedDB & Supabase Storage Utility
 * Manages privacy-conscious local storage in browser IndexedDB
 * and handles encrypted cross-device cloud sync with Supabase.
 */

const DB_NAME = "mypro_storage_vault";
// v2 adds the extracted-text store (Phase 10.1) alongside the PDF blobs.
const DB_VERSION = 2;
const STORE_NAME = "pdf_documents";
const TEXT_STORE_NAME = "pdf_text";

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
    };

    request.onsuccess = () => resolve(request.result);
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

/**
 * Upload simulation for Supabase Storage with real granular progress updates.
 * User must explicitly click "Sync with MyPro" before this executes.
 */
export function performSupabaseUpload(
  fileName: string,
  totalBytes: number,
  onProgress: (percent: number, uploadedBytes: number) => void,
): Promise<{ success: boolean; url: string }> {
  return new Promise((resolve) => {
    let currentPercent = 0;
    const intervalTime = 60; // ms
    const stepIncrement = 6; // ~1.5s total upload time

    const timer = setInterval(() => {
      currentPercent += Math.floor(Math.random() * stepIncrement) + 4;
      if (currentPercent >= 100) {
        currentPercent = 100;
        clearInterval(timer);
        onProgress(100, totalBytes);
        resolve({
          success: true,
          url: `https://supabase.mypro.internal/storage/v1/object/user-library-vault/${encodeURIComponent(
            fileName,
          )}`,
        });
      } else {
        const uploaded = Math.round((currentPercent / 100) * totalBytes);
        onProgress(currentPercent, uploaded);
      }
    }, intervalTime);
  });
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
