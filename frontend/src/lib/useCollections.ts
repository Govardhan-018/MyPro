/**
 * Collections — the shelves you sort your library onto.
 *
 * `/collections` and `collection_items` have been implemented server-side
 * since the library landed, but the view held five hard-coded names in local
 * state: renaming one, adding one or reordering them looked like it worked
 * and was gone on the next reload. This is the same screen reading and
 * writing the real rows.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { isApiConfigured } from './env';

export interface Collection {
  id: string;
  name: string;
  /** How many library items are filed under it. */
  count: number;
  sortOrder: number;
}

export interface CollectionsState {
  collections: Collection[];
  loading: boolean;
  error: string | null;
  /** Returns the new row's id, so the caller can put it straight into edit. */
  create: (name: string) => Promise<string | null>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Persist a drag-reorder as `sort_order` on each affected row. */
  reorder: (ordered: Collection[]) => Promise<void>;
  addItem: (collectionId: string, itemId: string) => Promise<void>;
  removeItem: (collectionId: string, itemId: string) => Promise<void>;
  reload: () => void;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Supabase returns the embed as an array of `{ library_item_id }`. */
function countOf(row: Record<string, unknown>): number {
  const items = row.collection_items;
  return Array.isArray(items) ? items.length : 0;
}

export function useCollections(enabled = true): CollectionsState {
  const configured = isApiConfigured;
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(configured && enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured || !enabled) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const rows = await api.collections.list();
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
  }, [configured, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback<CollectionsState['create']>(
    async (name) => {
      if (!configured) return null;
      try {
        const created = (await api.collections.create(
          name,
          collections.length,
        )) as Record<string, unknown>;
        const id = str(created?.id);
        await load();
        return id || null;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not add that collection.');
        return null;
      }
    },
    [configured, collections.length, load],
  );

  const rename = useCallback<CollectionsState['rename']>(
    async (id, name) => {
      const trimmed = name.trim();
      if (!configured || !trimmed) return;
      // Optimistic: a name that snaps back while you type reads as a bug.
      setCollections((current) =>
        current.map((item) => (item.id === id ? { ...item, name: trimmed } : item)),
      );
      try {
        await api.collections.update(id, { name: trimmed });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not rename that.');
        void load();
      }
    },
    [configured, load],
  );

  const remove = useCallback<CollectionsState['remove']>(
    async (id) => {
      if (!configured) return;
      setCollections((current) => current.filter((item) => item.id !== id));
      try {
        await api.collections.remove(id);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not delete that.');
        void load();
      }
    },
    [configured, load],
  );

  const reorder = useCallback<CollectionsState['reorder']>(
    async (ordered) => {
      if (!configured) return;
      setCollections(ordered.map((item, index) => ({ ...item, sortOrder: index })));
      try {
        await Promise.all(
          ordered.map((item, index) =>
            item.sortOrder === index
              ? Promise.resolve()
              : api.collections.update(item.id, { sort_order: index }),
          ),
        );
      } catch {
        void load();
      }
    },
    [configured, load],
  );

  const addItem = useCallback<CollectionsState['addItem']>(
    async (collectionId, itemId) => {
      if (!configured) return;
      try {
        await api.collections.addItem(collectionId, itemId);
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not file that.');
      }
    },
    [configured, load],
  );

  const removeItem = useCallback<CollectionsState['removeItem']>(
    async (collectionId, itemId) => {
      if (!configured) return;
      try {
        await api.collections.removeItem(collectionId, itemId);
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not remove that.');
      }
    },
    [configured, load],
  );

  return {
    collections,
    loading,
    error,
    create,
    rename,
    remove,
    reorder,
    addItem,
    removeItem,
    reload: () => void load(),
  };
}
