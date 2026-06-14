import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useCollections } from '@/hooks/useCollections';
import { useEscape } from '@/hooks/useEscape';
import { LoginForm } from '@/components/LoginForm';
import { BookmarkGrid } from '@/components/BookmarkGrid';
import { CollectionSidebar, type LibraryFilter } from '@/components/CollectionSidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { AIAssistant } from '@/components/AIAssistant';
import { AddDialog } from '@/components/AddDialog';
import { EditDialog } from '@/components/EditDialog';
import { HighlightsView } from '@/components/HighlightsView';
import { Icon, type IconName } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import {
  searchBookmarks,
  deleteBookmark,
  toggleFavorite,
  getAllTags,
  vaultStats,
} from '@/lib/bookmarks';
import { type Bookmark, type SortMode, type ViewMode, type VaultStats } from '@/lib/types';

export default function App() {
  const { ready, authed, email, login, signup, logout } = useAuth();
  const { settings, update } = useSettings();
  const collectionsApi = useCollections(authed);
  const { toast } = useToast();

  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);

  const view = settings.view;
  const sort = settings.sort;

  const runSearch = useCallback(async () => {
    if (!authed || filter.kind === 'highlights') return;
    setLoading(true);
    try {
      const opts: Parameters<typeof searchBookmarks>[1] = { sort, perPage: 200 };
      if (filter.kind === 'collection') opts.collection = filter.id;
      else if (filter.kind === 'favorites') opts.favorite = true;
      else if (filter.kind === 'untagged') opts.untagged = true;
      else if (filter.kind === 'tag') opts.tag = filter.tag;
      setItems(await searchBookmarks(debouncedQuery, opts));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [authed, filter, debouncedQuery, sort]);

  const refreshMeta = useCallback(async () => {
    if (!authed) return;
    try {
      setTags(await getAllTags());
      setStats(await vaultStats());
    } catch {
      /* ignore */
    }
  }, [authed]);

  // Debounce the filter input so we don't search on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);
  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);

  // Global ⌘K / Ctrl-K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Escape closes the AI slide-over.
  useEscape(() => setAiOpen(false), aiOpen);

  async function remove(id: string) {
    await deleteBookmark(id);
    setItems((p) => p.filter((b) => b.id !== id));
    toast('Deleted', 'info');
    refreshMeta();
    collectionsApi.refresh();
  }
  async function fav(b: Bookmark) {
    const updated = await toggleFavorite(b.id, !b.favorite);
    setItems((p) => p.map((x) => (x.id === b.id ? updated : x)));
    refreshMeta();
  }
  function onEdited(b: Bookmark) {
    setItems((p) => p.map((x) => (x.id === b.id ? b : x)));
    refreshMeta();
    collectionsApi.refresh();
  }

  const allTagNames = useMemo(() => tags.map((t) => t.tag), [tags]);

  const isHighlights = filter.kind === 'highlights';

  const heading = useMemo(() => {
    if (filter.kind === 'all') return 'All bookmarks';
    if (filter.kind === 'favorites') return 'Favorites';
    if (filter.kind === 'untagged') return 'Untagged';
    if (filter.kind === 'highlights') return 'Highlights';
    if (filter.kind === 'tag') return `#${filter.tag}`;
    return collectionsApi.collections.find((c) => c.id === filter.id)?.name ?? 'Collection';
  }, [filter, collectionsApi.collections]);

  if (!ready) return <div className="grid h-screen place-items-center text-ink-faint">Loading…</div>;
  if (!authed)
    return (
      <div className="grid h-screen place-items-center bg-surface-sunken">
        <div className="card w-full max-w-sm">
          <LoginForm onLogin={login} onSignup={signup} />
        </div>
      </div>
    );

  const paletteCommands = [
    { id: 'new', label: 'New bookmark', icon: 'plus' as IconName, run: () => setAddOpen(true) },
    { id: 'ask', label: 'Ask your library (AI)', icon: 'sparkles' as IconName, run: () => setAiOpen(true) },
    { id: 'all', label: 'Go to: All bookmarks', icon: 'grid' as IconName, run: () => setFilter({ kind: 'all' }) },
    { id: 'fav', label: 'Go to: Favorites', icon: 'star' as IconName, run: () => setFilter({ kind: 'favorites' }) },
    { id: 'settings', label: 'Open settings', icon: 'settings' as IconName, run: () => browser.runtime.openOptionsPage() },
  ];

  return (
    <div className="flex h-screen bg-surface-sunken text-ink">
      <CollectionSidebar
        collections={collectionsApi.collections}
        counts={collectionsApi.counts}
        total={stats?.total ?? 0}
        favorites={stats?.favorites ?? 0}
        highlights={stats?.highlights ?? 0}
        tags={tags}
        selected={filter}
        onSelect={setFilter}
        onCreate={collectionsApi.create}
        onRename={collectionsApi.rename}
        onRemove={collectionsApi.remove}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
              <Icon name="bookmark" size={17} fill />
            </span>
            <span className="text-base font-semibold">Keepsake</span>
          </div>

          <button
            className="ml-3 flex flex-1 items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink-faint transition hover:border-brand/40"
            onClick={() => setPaletteOpen(true)}
          >
            <Icon name="search" size={16} />
            Search everything…
            <kbd className="ml-auto rounded border border-line px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>

          <button className="btn-outline px-2.5" onClick={() => setAiOpen(true)} title="Ask your library">
            <Icon name="sparkles" size={16} />
          </button>
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={16} /> Add
          </button>

          <AccountMenu email={email} onLogout={logout} />
        </header>

        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
          <h1 className="text-sm font-semibold text-ink">{heading}</h1>
          {!isHighlights && <span className="text-xs text-ink-faint">{items.length} items</span>}

          {!isHighlights && (
            <>
              <input
                className="ml-auto w-48 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-sm outline-none focus:border-brand/50"
                placeholder="Filter results…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

              <select
                className="rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm outline-none"
                value={sort}
                onChange={(e) => update({ sort: e.target.value as SortMode })}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="title">Title A–Z</option>
                <option value="domain">Domain</option>
                <option value="lastVisited">Recently opened</option>
              </select>

              <div className="flex rounded-lg border border-line bg-surface-raised p-0.5">
                {(['grid', 'list', 'masonry'] as ViewMode[]).map((v) => (
                  <button
                    key={v}
                    className={`rounded-md p-1.5 ${view === v ? 'bg-brand/10 text-brand' : 'text-ink-faint hover:text-ink'}`}
                    onClick={() => update({ view: v })}
                    title={v}
                  >
                    <Icon name={v === 'grid' ? 'grid' : v === 'list' ? 'list' : 'masonry'} size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Body */}
        <main className="flex-1 overflow-y-auto p-5">
          {isHighlights ? (
            <HighlightsView onCountChange={refreshMeta} />
          ) : (
            <BookmarkGrid
              items={items}
              loading={loading}
              view={view}
              onDelete={remove}
              onToggleFavorite={fav}
              onEdit={setEditing}
              emptyHint={
                filter.kind === 'all'
                  ? 'Click “Add”, use the toolbar icon, or right-click any page → “Save page to Keepsake”.'
                  : 'Nothing matches this filter yet.'
              }
            />
          )}
        </main>
      </div>

      {/* Overlays */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} />

      {aiOpen && (
        <div className="fixed inset-0 z-[2147483645] flex justify-end bg-black/30 backdrop-blur-sm animate-fade-in" onClick={() => setAiOpen(false)}>
          <div className="h-full w-full max-w-md border-l border-line bg-surface animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <AIAssistant onClose={() => setAiOpen(false)} />
          </div>
        </div>
      )}

      {addOpen && (
        <AddDialog
          collections={collectionsApi.collections}
          allTags={allTagNames}
          defaultCollection={filter.kind === 'collection' ? filter.id : settings.defaultCollection}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            runSearch();
            refreshMeta();
            collectionsApi.refresh();
          }}
        />
      )}

      {editing && (
        <EditDialog
          bookmark={editing}
          collections={collectionsApi.collections}
          allTags={allTagNames}
          onClose={() => setEditing(null)}
          onSaved={onEdited}
        />
      )}
    </div>
  );
}

function AccountMenu({ email, onLogout }: { email: string | null; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        className="grid h-9 w-9 place-items-center rounded-full bg-brand/10 text-sm font-semibold uppercase text-brand"
        onClick={() => setOpen((o) => !o)}
        title={email ?? 'Account'}
      >
        {email?.[0] ?? '?'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-52 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-float animate-pop-in">
            <div className="border-b border-line px-3 py-2 text-xs text-ink-faint">{email}</div>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-soft hover:bg-surface-sunken"
              onClick={() => browser.runtime.openOptionsPage()}
            >
              <Icon name="settings" size={15} /> Settings
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10"
              onClick={onLogout}
            >
              <Icon name="logout" size={15} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
