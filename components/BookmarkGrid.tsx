import { useEffect, useState } from 'react';
import { searchBookmarks, deleteBookmark } from '@/lib/bookmarks';
import { type Bookmark } from '@/lib/types';
import { BookmarkCard } from './BookmarkCard';

// Search + results grid. Reused by the dashboard (wide) and the side panel (narrow).
export function BookmarkGrid({ columns = 'auto' }: { columns?: 'auto' | 'single' }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  async function run(q: string) {
    setLoading(true);
    try {
      setItems(await searchBookmarks(q));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run('');
  }, []);

  // Debounced live search.
  useEffect(() => {
    const id = setTimeout(() => run(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  async function remove(id: string) {
    await deleteBookmark(id);
    setItems((prev) => prev.filter((b) => b.id !== id));
  }

  const gridClass =
    columns === 'single'
      ? 'grid grid-cols-1 gap-3'
      : 'grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4';

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 bg-white p-3 dark:bg-gray-900">
        <input
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
          placeholder="Search title, url, tags…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400">No bookmarks yet.</p>
        ) : (
          <div className={gridClass}>
            {items.map((b) => (
              <BookmarkCard key={b.id} bookmark={b} onDelete={remove} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
