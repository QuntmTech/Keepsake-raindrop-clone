import { useCallback, useEffect, useState } from 'react';
import {
  listCollections,
  countByCollection,
  createCollection,
  updateCollection,
  deleteCollection,
} from '@/lib/bookmarks';
import { type Collection } from '@/lib/types';
import { readLastSnapshot } from '@/lib/cache';

// Loads collections + per-collection counts and exposes CRUD that refreshes state.
export function useCollections(authed: boolean) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!authed) return;
    try {
      const [nextCollections, nextCounts] = await Promise.all([listCollections(), countByCollection()]);
      setCollections(nextCollections);
      setCounts(nextCounts);
    } catch {
      // Keep the cached snapshot when PocketBase is slow or temporarily offline.
    } finally {
      setLoading(false);
    }
  }, [authed]);

  // Paint cached collections directly from chrome.storage before constructing the
  // backend. Logout clears the snapshot, so this never crosses user sessions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snapshot = await readLastSnapshot();
      if (!cancelled && snapshot) {
        setCollections(snapshot.collections);
        setCounts(snapshot.counts);
        setLoading(false);
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const create = useCallback(
    async (data: { name: string; color?: string; icon?: string; parent?: string }) => {
      const collection = await createCollection(data);
      await refresh();
      return collection;
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

  // Persist a new top-to-bottom order by writing each collection's sort index.
  const reorder = useCallback(
    async (ids: string[]) => {
      setCollections((previous) => {
        const map = new Map(previous.map((collection) => [collection.id, collection]));
        return ids.map((id) => map.get(id)).filter((collection): collection is Collection => Boolean(collection));
      });
      try {
        await Promise.all(ids.map((id, index) => updateCollection(id, { sort: index })));
      } finally {
        await refresh();
      }
    },
    [refresh],
  );

  return { collections, counts, loading, refresh, create, rename, remove, reorder };
}
