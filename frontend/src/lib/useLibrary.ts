import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { LibraryItem } from '../types/library';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';
import { itemToCreateBody, itemToPatchBody, rowToItem } from './libraryMap';

/**
 * How long to let progress settle before writing it back.
 *
 * The reader and the podcast player auto-save on every change, and "every
 * change" means every page the scroll crosses and every half-second the
 * player ticks — which turned a ten-minute listen into roughly a thousand
 * PATCHes. Only the last value of a burst matters, so each item keeps one
 * trailing timer.
 */
const WRITE_BACK_MS = 1200;

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
  const [items, setItems] = useState<LibraryItem[]>(configured ? [] : seed);
  const [loading, setLoading] = useState<boolean>(configured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    api.library
      .list()
      .then((rows) => {
        if (!active) return;
        setItems(rows.map(rowToItem));
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(message(caught));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [configured]);

  /** One trailing timer per item id, plus the latest body to send for it. */
  const pending = useRef<Map<string, { timer: number; item: LibraryItem }>>(new Map());

  const persist = useCallback(
    (item: LibraryItem) => {
      if (!configured || !item.id) return;
      const id = item.id;
      const queued = pending.current.get(id);
      if (queued) window.clearTimeout(queued.timer);
      const timer = window.setTimeout(() => {
        const latest = pending.current.get(id);
        pending.current.delete(id);
        if (!latest) return;
        api.library.update(id, itemToPatchBody(latest.item)).catch(() => {
          /* best-effort write-back; the UI already reflects the change */
        });
      }, WRITE_BACK_MS);
      pending.current.set(id, { timer, item });
    },
    [configured],
  );

  /** Send whatever is still queued (tab closing, hook unmounting). */
  const flushPending = useCallback(() => {
    for (const [id, queued] of pending.current) {
      window.clearTimeout(queued.timer);
      api.library.update(id, itemToPatchBody(queued.item)).catch(() => {});
    }
    pending.current.clear();
  }, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPending();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flushPending();
    };
  }, [flushPending]);

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
        const updated = patch(current[target]);
        // Defer the network write out of the state-updater pass.
        queueMicrotask(() => persist(updated));
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

  return { items, setItems, loading, error, configured, updateItem, createItem, removeItem };
}
