import { useEffect, useState } from 'react';
import {
  searchBookmarks,
  deleteBookmark,
  toggleFavorite,
  listCollections,
  getAllTags,
  watchVault,
} from '@/lib/bookmarks';
import { type Bookmark, type Collection } from '@/lib/types';
import { BookmarkGrid } from './BookmarkGrid';
import { EditDialog } from './EditDialog';
import { Icon } from './Icon';
import { useToast } from './Toast';

// Compact search + results list, shared by the popup and side panel so your
// whole library is reachable without opening the full-screen dashboard.
export function LibraryBrowser({ autoFocus = false }: { autoFocus?: boolean }) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [editing, setEditing] = useState<Bookmark | null>(null);

  const loadMeta = () => {
    listCollections().then(setCollections).catch(() => {});
    getAllTags().then((t) => setTags(t.map((x) => x.tag))).catch(() => {});
  };

  useEffect(() => {
    const id = setTimeout(() => {
      setLoading(true);
      searchBookmarks(query, { perPage: 60 })
        .then(setItems)
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    loadMeta();
  }, []);

  // Live refresh when the vault changes anywhere.
  useEffect(() => {
    return watchVault(() => {
      searchBookmarks(query, { perPage: 60 }).then(setItems).catch(() => {});
      loadMeta();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function remove(id: string) {
    await deleteBookmark(id);
    setItems((p) => p.filter((b) => b.id !== id));
    toast('Deleted', 'info');
  }
  async function fav(b: Bookmark) {
    const updated = await toggleFavorite(b.id, !b.favorite);
    setItems((p) => p.map((x) => (x.id === b.id ? updated : x)));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 bg-surface p-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 focus-within:border-brand/50">
          <Icon name="search" size={16} className="text-ink-faint" />
          <input
            className="flex-1 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
            placeholder="Search your vault…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus={autoFocus}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 pt-0">
        <BookmarkGrid items={items} loading={loading} view="list" onDelete={remove} onToggleFavorite={fav} onEdit={setEditing} />
      </div>

      {editing && (
        <EditDialog
          bookmark={editing}
          collections={collections}
          allTags={tags}
          onClose={() => setEditing(null)}
          onSaved={(b) => setItems((p) => p.map((x) => (x.id === b.id ? b : x)))}
        />
      )}
    </div>
  );
}
