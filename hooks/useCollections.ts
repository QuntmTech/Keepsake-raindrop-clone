import { useCallback, useEffect, useState } from 'react';
import {
  listCollections,
  countByCollection,
  createCollection,
  updateCollection,
  deleteCollection,
} from '@/lib/bookmarks';
import { type Collection } from '@/lib/types';

// Loads collections + per-collection counts and exposes CRUD that refreshes state.
export function useCollections(authed: boolean) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    try {
      const [cols, cnt] = await Promise.all([listCollections(), countByCollection()]);
      setCollections(cols);
      setCounts(cnt);
    } catch {
      setCollections([]);
    } finally {
      setLoading(false);
    }
  }, [authed]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (data: { name: string; color?: string; icon?: string; parent?: string }) => {
      const c = await createCollection(data);
      await refresh();
      return c;
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, patch: Partial<Collection>) => {
      await updateCollection(id, patch);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteCollection(id);
      await refresh();
    },
    [refresh],
  );

  // Persist a new top-to-bottom order by writing each collection's `sort` index.
  const reorder = useCallback(
    async (ids: string[]) => {
      setCollections((prev) => {
        const map = new Map(prev.map((c) => [c.id, c]));
        return ids.map((id) => map.get(id)).filter((c): c is Collection => Boolean(c));
      });
      try {
        await Promise.all(ids.map((id, i) => updateCollection(id, { sort: i })));
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  return { collections, counts, loading, refresh, create, rename, remove, reorder };
}
