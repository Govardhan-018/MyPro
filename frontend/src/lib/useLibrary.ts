import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { LibraryItem } from '../types/library';
import { api, ApiError } from './api';
import { isApiConfigured } from './env';
import { itemToCreateBody, itemToPatchBody, rowToItem } from './libraryMap';

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

  const persist = useCallback(
    (item: LibraryItem) => {
      if (!configured || !item.id) return;
      api.library.update(item.id, itemToPatchBody(item)).catch(() => {
        /* best-effort write-back; the UI already reflects the change */
      });
    },
    [configured],
  );

  const updateItem = useCallback(
    (title: string, patch: (item: LibraryItem) => LibraryItem) => {
      setItems((current) =>
        current.map((item) => {
          if (item.title !== title) return item;
          const updated = patch(item);
          // Defer the network write out of the state-updater pass.
          queueMicrotask(() => persist(updated));
          return updated;
        }),
      );
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
