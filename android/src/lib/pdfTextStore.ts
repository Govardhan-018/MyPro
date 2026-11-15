import * as FileSystem from 'expo-file-system';
import { isPdfTextDoc, type PdfTextDoc, type PdfTextStore } from '@mypro/shared';

/**
 * The device cache for extracted PDF text (Phase 10.2, the reading half).
 *
 * Android never sees the raw PDF — the device that holds the file extracts it
 * and uploads the structured JSON. This keeps a copy on disk so a book opens
 * instantly, and offline, after the first read. The documents run to hundreds
 * of kilobytes, well past AsyncStorage's per-row limit, so they live as files.
 */
const DIRECTORY = `${FileSystem.documentDirectory ?? ''}pdf-text/`;

const fileFor = (key: string) => `${DIRECTORY}${encodeURIComponent(key)}.json`;

async function ensureDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIRECTORY);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DIRECTORY, { intermediates: true });
  }
}

export const pdfTextStore: PdfTextStore = {
  async load(key: string): Promise<PdfTextDoc | null> {
    try {
      const file = fileFor(key);
      const info = await FileSystem.getInfoAsync(file);
      if (!info.exists) return null;
      const parsed: unknown = JSON.parse(await FileSystem.readAsStringAsync(file));
      return isPdfTextDoc(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },

  async save(key: string, doc: PdfTextDoc): Promise<void> {
    try {
      await ensureDirectory();
      await FileSystem.writeAsStringAsync(fileFor(key), JSON.stringify(doc));
    } catch {
      // The cache is a convenience; reading must not depend on it.
    }
  },
};

/** Drop a cached document (re-download on the next open). */
export async function forgetPdfText(key: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(fileFor(key), { idempotent: true });
  } catch {
    // Nothing to do.
  }
}
