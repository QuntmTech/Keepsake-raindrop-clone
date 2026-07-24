import { useCallback, useEffect, useState } from 'react';
import {
  listCollections,
  countByCollection,
  createCollection,
  updateCollection,
  deleteCollection,
} from '@/lib/bookmarks';
import { readSnapshot } from '@/lib/cache';
import { type Collection } from '@/lib/types';

// Loads collections + per-collection counts and exposes CRUD that refreshes state.
interface UseCollectionsOptions {
  userId?: string | null;
  deferCounts?: boolean;
}

export function useCollections(authed: boolean, options: UseCollectionsOptions = {}) {
  const userId = options.userId ?? null;
  const deferCounts = Boolean(options.deferCounts);
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

  // Home already has the cached auth id, so it can read its snapshot without a
  // second auth-storage round trip. When deferCounts is enabled, collection rows
  // refresh first and the heavier aggregate counts wait until after first paint.
  useEffect(() => {
    let cancelled = false;
    let rowsTimer: ReturnType<typeof setTimeout> | null = null;
    let countsTimer: ReturnType<typeof setTimeout> | null = null;

    const loadRowsThenCounts = async () => {
      try {
        const nextCollections = await listCollections();
        if (!cancelled) setCollections(nextCollections);
      } catch {
        // Cached folders stay visible while offline or during a slow server start.
      } finally {
        if (!cancelled) setLoading(false);
      }
      countsTimer = setTimeout(() => {
        countByCollection()
          .then((nextCounts) => {
            if (!cancelled) setCounts(nextCounts);
          })
          .catch(() => {});
      }, 650);
    };

    (async () => {
      const snapshot = await readSnapshot(userId);
      if (!cancelled && snapshot) {
        setCollections(snapshot.collections);
        setCounts(snapshot.counts);
        setLoading(false);
      }
      if (!authed || cancelled) {
        if (!authed) setLoading(false);
        return;
      }
      if (!deferCounts) {
        await refresh();
        return;
      }
      if (snapshot) rowsTimer = setTimeout(loadRowsThenCounts, 180);
      else await loadRowsThenCounts();
    })();

    return () => {
      cancelled = true;
      if (rowsTimer) clearTimeout(rowsTimer);
      if (countsTimer) clearTimeout(countsTimer);
    };
  }, [authed, deferCounts, refresh, userId]);

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
