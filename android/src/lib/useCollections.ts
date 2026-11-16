/**
 * Collections on the phone, reading the same `/collections` rows the web app
 * does. Nothing is kept locally: the shelf you make here is the shelf the
 * browser shows.
 */
import { useCallback, useEffect, useState } from 'react';
import { client } from './client';

export interface Collection {
  id: string;
  name: string;
  /** How many library items are filed under it. */
  count: number;
  sortOrder: number;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Supabase returns the embed as an array of `{ library_item_id }`. */
function countOf(row: Record<string, unknown>): number {
  const items = row.collection_items;
  return Array.isArray(items) ? items.length : 0;
}

export interface CollectionsState {
  collections: Collection[];
  loading: boolean;
  error: string | null;
  create: (name: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  addItem: (collectionId: string, itemId: string) => Promise<void>;
  removeItem: (collectionId: string, itemId: string) => Promise<void>;
  reload: () => void;
}

export function useCollections(): CollectionsState {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await client.api.collections.list();
      setCollections(
        rows
          .map((row) => ({
            id: str(row.id),
            name: str(row.name) || 'Untitled collection',
            count: countOf(row),
            sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your collections.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        await client.api.collections.create(trimmed, collections.length);
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not add that collection.');
      }
    },
    [collections.length, load],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      // Optimistic: a name that snaps back while you type reads as a bug.
      setCollections((current) =>
        current.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
      );
      try {
        await client.api.collections.update(id, { name: trimmed });
      } catch {
        void load();
      }
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setCollections((current) => current.filter((item) => item.id !== id));
      try {
        await client.api.collections.remove(id);
      } catch {
        void load();
      }
    },
    [load],
  );

  const addItem = useCallback(
    async (collectionId: string, itemId: string) => {
      try {
        await client.api.collections.addItem(collectionId, itemId);
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not file that.');
      }
    },
    [load],
  );

  const removeItem = useCallback(
    async (collectionId: string, itemId: string) => {
      try {
        await client.api.collections.removeItem(collectionId, itemId);
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not remove that.');
      }
    },
    [load],
  );

  return {
    collections,
    loading,
    error,
    create,
    rename,
    remove,
    addItem,
    removeItem,
    reload: () => void load(),
  };
}
