import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { LibraryItem } from '../types/library';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';
import { itemToCreateBody, itemToPatchBody, rowToItem } from './libraryMap';
import { outbox } from './outbox';

/**
 * The last library this device saw, per user, so the app opens with your
 * books (and their latest local progress) with no connection at all.
 */
const cacheKey = (uid: string) => `mypro.library.${uid}`;

function userId(): string | null {
  try {
    const raw = localStorage.getItem('mypro.session');
    return raw ? ((JSON.parse(raw) as { user?: { id?: string } }).user?.id ?? null) : null;
  } catch {
    return null;
  }
}

function readCache(): LibraryItem[] | null {
  const uid = userId();
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as LibraryItem[]) : null;
  } catch {
    return null;
  }
}

function writeCache(items: LibraryItem[]): void {
  const uid = userId();
  if (!uid) return;
  try {
    // Only the fields the list and reader need offline; never blobs.
    localStorage.setItem(cacheKey(uid), JSON.stringify(items));
  } catch {
    /* quota: the cache is a convenience */
  }
}

/** Fields that make up a reading/listening position. */
const positionOf = (item: LibraryItem) =>
  `${item.currentPage ?? ''}|${item.currentTimeSeconds ?? ''}|${item.progress ?? ''}`;

/** A failure that means "no connection / server unreachable", not "you can't". */
function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status >= 500;
}

export interface LibraryState {
  items: LibraryItem[];
  setItems: Dispatch<SetStateAction<LibraryItem[]>>;
  loading: boolean;
  error: string | null;
  configured: boolean;
  /** title-keyed update that also persists the result to the API. */
  updateItem: (title: string, patch: (item: LibraryItem) => LibraryItem) => void;
  /** Create on the server (or locally when unconfigured); returns the stored item. */
  createItem: (item: LibraryItem) => Promise<LibraryItem>;
  /** Remove locally and on the server. */
  removeItem: (item: LibraryItem) => Promise<void>;
  /** Showing the saved copy because the server could not be reached. */
  offline: boolean;
}

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Could not load your library.';
}

/**
 * The library's data layer. When the backend is configured it loads items from
 * `/library`, maps rows to the UI model, and persists create/update/delete.
 * Otherwise it runs on the provided seed so the prototype still works offline.
 */
export function useLibrary(seed: LibraryItem[]): LibraryState {
  const configured = isApiConfigured;
  const [items, setItems] = useState<LibraryItem[]>(() => (configured ? (readCache() ?? []) : seed));
  const [loading, setLoading] = useState<boolean>(configured && !readCache());
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await api.library.list();
      const fresh = rows.map(rowToItem);
      // An item with changes still waiting in the outbox keeps this device's
      // copy: the server has not seen them yet, and showing its older progress
      // would look like the reading was lost.
      const waiting = outbox.pendingItemIds();
      const local = new Map((readCache() ?? []).map((item) => [item.id, item]));
      setItems(
        fresh.map((item) =>
          item.id && waiting.has(item.id) && local.has(item.id) ? { ...item, ...local.get(item.id)! } : item,
        ),
      );
      setError(null);
      setOffline(false);
    } catch (caught) {
      const cached = readCache();
      if (cached && isNetworkFailure(caught)) {
        setItems(cached);
        setOffline(true);
        setError(null);
      } else {
        setError(message(caught));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    void load();
    // Back online: refresh once the queued changes have gone up.
    const onOnline = () => void outbox.flush().then(load);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [configured, load]);

  // Keep the offline copy current with every local change.
  useEffect(() => {
    if (!configured || loading) return;
    const timer = window.setTimeout(() => writeCache(items), 400);
    return () => window.clearTimeout(timer);
  }, [configured, loading, items]);

  // The server is the referee: after a queued change lands, adopt what it
  // kept (an older offline position loses to a newer one from elsewhere).
  useEffect(() => {
    if (!configured) return;
    return outbox.onApplied((op, result) => {
      if (op.kind !== 'library.patch' || !result || typeof result !== 'object') return;
      if (outbox.pendingFor(op.itemId).some((p) => p.kind === 'library.patch')) return;
      const server = rowToItem(result as Parameters<typeof rowToItem>[0]);
      setItems((current) =>
        current.map((item) =>
          item.id === op.itemId && positionOf(item) !== positionOf(server)
            ? {
                ...item,
                progress: server.progress,
                currentPage: server.currentPage,
                currentTimeSeconds: server.currentTimeSeconds,
                status: server.status,
              }
            : item,
        ),
      );
    });
  }, [configured]);

  /**
   * Queue a write-back. Every change goes to the durable outbox (bursts of
   * page turns collapse into one PATCH per item there), stamped with when the
   * position changed so a late offline write cannot rewind another device.
   */
  const persist = useCallback(
    (item: LibraryItem, positionChanged: boolean) => {
      if (!configured || !item.id) return;
      const body = itemToPatchBody(item);
      if (positionChanged) body.position_at = new Date().toISOString();
      outbox.push({ kind: 'library.patch', itemId: item.id, body });
    },
    [configured],
  );

  useEffect(() => {
    // Leaving the page or backgrounding the app: send what is queued now.
    const onHide = () => {
      if (document.visibilityState === 'hidden') void outbox.flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  /**
   * Update one item, found by its id or — for the unsaved/prototype case —
   * its title.
   *
   * Title alone was the whole key, which quietly lost writes whenever the
   * caller held a newer title than the stored row: the podcast player sends
   * its edited episode title back with the notes, so `updateItem('Designing
   * for trust and calm', …)` matched nothing while the row was still called
   * 'Design Better', and every note typed during an episode vanished.
   */
  const updateItem = useCallback(
    (key: string, patch: (item: LibraryItem) => LibraryItem) => {
      setItems((current) => {
        const index = current.findIndex((item) => item.id === key);
        const target = index === -1 ? current.findIndex((item) => item.title === key) : index;
        if (target === -1) return current;
        const previous = current[target];
        const updated = patch(previous);
        // Defer the write out of the state-updater pass.
        queueMicrotask(() => persist(updated, positionOf(previous) !== positionOf(updated)));
        return current.map((item, i) => (i === target ? updated : item));
      });
    },
    [persist],
  );

  const createItem = useCallback(
    async (item: LibraryItem) => {
      if (!configured) {
        setItems((current) => [item, ...current]);
        return item;
      }
      const row = await api.library.create(itemToCreateBody(item));
      const mapped = rowToItem(row);
      setItems((current) => [mapped, ...current]);
      return mapped;
    },
    [configured],
  );

  const removeItem = useCallback(
    async (item: LibraryItem) => {
      setItems((current) => current.filter((entry) => entry !== item && entry.id !== item.id));
      if (configured && item.id) {
        await api.library.remove(item.id).catch(() => {});
      }
    },
    [configured],
  );

  return { items, setItems, loading, error, configured, updateItem, createItem, removeItem, offline };
}
