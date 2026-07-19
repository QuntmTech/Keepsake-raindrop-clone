import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { currentUser } from '@/lib/auth';
import { readSnapshot, writeSnapshot } from '@/lib/cache';
import { useSettings } from '@/hooks/useSettings';
import { useCollections } from '@/hooks/useCollections';
import { useEscape } from '@/hooks/useEscape';
import { LoginForm } from '@/components/LoginForm';
import { BookmarkGrid } from '@/components/BookmarkGrid';
import { BulkActionBar } from '@/components/BulkActionBar';
import { CollectionSidebar, type LibraryFilter } from '@/components/CollectionSidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { AIAssistant } from '@/components/AIAssistant';
import { AddDialog } from '@/components/AddDialog';
import { EditDialog } from '@/components/EditDialog';
import { HighlightsView } from '@/components/HighlightsView';
import { ReaderView } from '@/components/ReaderView';
import { PlanBadge } from '@/components/PlanBadge';
import { Icon, type IconName } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import {
  searchBookmarks,
  deleteBookmark,
  toggleFavorite,
  updateBookmark,
  getAllTags,
  vaultStats,
  watchVault,
  homeOnlyCollectionIds,
} from '@/lib/bookmarks';
import { semanticFind } from '@/lib/ai';
import { mergeBookmarkTags, runBulkTasks, selectedBookmarks } from '@/lib/bulk';
import { send } from '@/lib/messaging';
import { type Bookmark, type Plan, type SortMode, type ViewMode, type VaultStats } from '@/lib/types';

export default function App() {
  const { ready, authed, email, plan, login, signup, logout } = useAuth();
  const { settings, update } = useSettings();
  const collectionsApi = useCollections(authed);
  const { toast } = useToast();

  const [filter, setFilter] = useState<LibraryFilter>(() => {
    // Open focused when launched from Home (e.g. dashboard.html#c=<id>).
    const h = typeof location !== 'undefined' ? location.hash : '';
    if (h.startsWith('#c=')) return { kind: 'collection', id: h.slice(3) };
    if (h === '#favorites') return { kind: 'favorites' };
    if (h === '#highlights') return { kind: 'highlights' };
    return { kind: 'all' };
  });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [homeOnlyCols, setHomeOnlyCols] = useState<string[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [reading, setReading] = useState<Bookmark | null>(null);
  const [aiResults, setAiResults] = useState<Bookmark[] | null>(null);
  const [aiSearching, setAiSearching] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  const view = settings.view;
  const sort = settings.sort;
  const visibleItems = useMemo(() => aiResults ?? items, [aiResults, items]);
  const visibleCollections = useMemo(
    () => collectionsApi.collections.filter((collection) => !homeOnlyCols.includes(collection.id)),
    [collectionsApi.collections, homeOnlyCols],
  );
  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((bookmark) => selectedIds.has(bookmark.id));

  const uidRef = useRef<string | null>(null);

  // Stale-while-revalidate: keep showing current items while refreshing.
  const runSearch = useCallback(async () => {
    if (!authed || filter.kind === 'highlights') return;
    try {
      const opts: Parameters<typeof searchBookmarks>[1] = { sort, perPage: 200 };
      if (filter.kind === 'collection') opts.collection = filter.id;
      else if (filter.kind === 'favorites') opts.favorite = true;
      else if (filter.kind === 'untagged') opts.untagged = true;
      else if (filter.kind === 'tag') opts.tag = filter.tag;
      const list = await searchBookmarks(debouncedQuery, opts);
      setItems(list);
      if (filter.kind === 'all' && !debouncedQuery.trim()) {
        writeSnapshot({
          uid: uidRef.current ?? '',
          bookmarks: list,
          collections: collectionsApi.collections,
          counts: collectionsApi.counts,
        });
      }
    } catch {
      /* keep stale items */
    } finally {
      setLoading(false);
    }
  }, [authed, filter, debouncedQuery, sort, collectionsApi.collections, collectionsApi.counts]);

  const refreshMeta = useCallback(async () => {
    if (!authed) return;
    try {
      const [t, s, hc] = await Promise.all([getAllTags(), vaultStats(), homeOnlyCollectionIds()]);
      setTags(t);
      setStats(s);
      setHomeOnlyCols(hc);
    } catch {
      /* ignore */
    }
  }, [authed]);

  // Paint cached bookmarks instantly on open.
  useEffect(() => {
    (async () => {
      uidRef.current = (await currentUser())?.id ?? null;
      const snap = await readSnapshot(uidRef.current);
      if (snap) {
        setItems(snap.bookmarks.filter((b) => !b.homeOnly));
        setLoading(false);
      }
    })();
  }, []);

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

  // Escape closes the AI slide-over or exits bulk selection.
  useEscape(() => setAiOpen(false), aiOpen);
  useEscape(
    () => {
      setSelectionMode(false);
      setSelectedIds(new Set<string>());
    },
    selectionMode && !aiOpen,
  );

  // Leaving a filter exits smart-search results and bulk selection.
  useEffect(() => {
    setAiResults(null);
    setSelectionMode(false);
    setSelectedIds(new Set<string>());
  }, [filter]);

  // Remove selections that disappeared after a live refresh or bulk action.
  useEffect(() => {
    const visible = new Set(visibleItems.map((bookmark) => bookmark.id));
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [visibleItems]);

  async function runSmartSearch() {
    const q = query.trim();
    if (!q) {
      toast('Type something to search for first', 'info');
      return;
    }
    setAiSearching(true);
    try {
      // semanticFind always has a deterministic local fallback. A configured
      // provider improves the reranking, but is no longer required to use it.
      const corpus = await searchBookmarks('', { perPage: 300 });
      setAiResults(await semanticFind(q, corpus));
      setSelectionMode(false);
      setSelectedIds(new Set<string>());
    } catch {
      toast('Smart search failed', 'error');
    } finally {
      setAiSearching(false);
    }
  }

  // Live-refresh when the vault changes anywhere (Quick Bar, shortcut, another tab).
  useEffect(() => {
    return watchVault(() => {
      runSearch();
      refreshMeta();
      collectionsApi.refresh();
    });
  }, [runSearch, refreshMeta, collectionsApi]);

  async function remove(id: string) {
    await deleteBookmark(id);
    setItems((p) => p.filter((b) => b.id !== id));
    setAiResults((p) => (p ? p.filter((b) => b.id !== id) : p));
    setSelectedIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    toast('Deleted', 'info');
    refreshMeta();
    collectionsApi.refresh();
  }

  async function fav(b: Bookmark) {
    const updated = await toggleFavorite(b.id, !b.favorite);
    setItems((p) => p.map((x) => (x.id === b.id ? updated : x)));
    setAiResults((p) => (p ? p.map((x) => (x.id === b.id ? updated : x)) : p));
    refreshMeta();
  }

  function onEdited(b: Bookmark) {
    setItems((p) => p.map((x) => (x.id === b.id ? b : x)));
    setAiResults((p) => (p ? p.map((x) => (x.id === b.id ? b : x)) : p));
    refreshMeta();
    collectionsApi.refresh();
  }

  // Drag a bookmark onto a collection (or "All bookmarks" to unsort it).
  async function moveToCollection(bookmarkId: string, collectionId: string | undefined) {
    const updated = await updateBookmark(bookmarkId, { collection: collectionId });
    // If we're viewing a specific collection, the moved item may leave the view.
    setItems((p) =>
      filter.kind === 'collection' && filter.id !== collectionId
        ? p.filter((b) => b.id !== bookmarkId)
        : p.map((b) => (b.id === bookmarkId ? updated : b)),
    );
    collectionsApi.refresh();
    const name = collectionId
      ? collectionsApi.collections.find((c) => c.id === collectionId)?.name ?? 'collection'
      : null;
    toast(name ? `Moved to ${name}` : 'Removed from collection', 'success');
  }

  function toggleSelected(bookmark: Bookmark) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(bookmark.id)) next.delete(bookmark.id);
      else next.add(bookmark.id);
      return next;
    });
  }

  function toggleSelectionMode() {
    setSelectionMode((enabled) => {
      if (enabled) setSelectedIds(new Set<string>());
      return !enabled;
    });
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds(new Set<string>());
      return;
    }
    setSelectedIds(new Set(visibleItems.map((bookmark) => bookmark.id)));
  }

  function finishSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set<string>());
  }

  async function afterBulkAction() {
    setAiResults(null);
    await runSearch();
    await refreshMeta();
    await Promise.resolve(collectionsApi.refresh());
    finishSelection();
  }

  async function runBulkAction(
    busyLabel: string,
    worker: (bookmark: Bookmark) => Promise<unknown>,
    successLabel: string,
  ) {
    const selected = selectedBookmarks(visibleItems, selectedIds);
    if (!selected.length || bulkBusy) return;

    setBulkBusy(busyLabel);
    try {
      const result = await runBulkTasks(selected, worker);
      await afterBulkAction();
      if (result.failed) {
        toast(`${result.completed} completed · ${result.failed} failed`, 'error');
      } else {
        toast(`${successLabel} ${result.completed} bookmark${result.completed === 1 ? '' : 's'}`, 'success');
      }
    } finally {
      setBulkBusy(null);
    }
  }

  async function bulkMove(collectionId: string | undefined) {
    const collectionName = collectionId
      ? visibleCollections.find((collection) => collection.id === collectionId)?.name ?? 'collection'
      : 'No collection';
    await runBulkAction(
      `Moving to ${collectionName}…`,
      (bookmark) => updateBookmark(bookmark.id, { collection: collectionId }),
      `Moved to ${collectionName}:`,
    );
  }

  async function bulkAddTag() {
    const raw = prompt('Tag to add to every selected bookmark');
    if (raw == null) return;
    const sample = mergeBookmarkTags([], raw)[0];
    if (!sample) {
      toast('Enter a valid tag', 'info');
      return;
    }
    await runBulkAction(
      `Adding #${sample}…`,
      (bookmark) => updateBookmark(bookmark.id, { tags: mergeBookmarkTags(bookmark.tags, sample) }),
      `Added #${sample} to`,
    );
  }

  async function bulkFavorite() {
    await runBulkAction(
      'Adding favorites…',
      (bookmark) => toggleFavorite(bookmark.id, true),
      'Favorited',
    );
  }

  async function bulkRetryAi() {
    await runBulkAction(
      'Retrying AI filing…',
      async (bookmark) => {
        const response = await send<{ ok: boolean; error?: string }>({ type: 'KS_AUTOFILE', id: bookmark.id });
        if (!response?.ok) throw new Error(response?.error || 'AI filing failed');
      },
      'Reprocessed',
    );
  }

  async function bulkDelete() {
    const count = selectedIds.size;
    if (!count || !confirm(`Delete ${count} selected bookmark${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    await runBulkAction('Deleting…', (bookmark) => deleteBookmark(bookmark.id), 'Deleted');
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

  const inbox = collectionsApi.collections.find((collection) => collection.name.toLowerCase() === 'inbox');
  const paletteCommands = [
    { id: 'new', label: 'New bookmark', icon: 'plus' as IconName, run: () => setAddOpen(true) },
    {
      id: 'newcol',
      label: 'New collection',
      icon: 'folder' as IconName,
      run: () => {
        const n = prompt('New collection name');
        if (n?.trim()) collectionsApi.create({ name: n.trim() });
      },
    },
    { id: 'ask', label: 'Ask your library', icon: 'sparkles' as IconName, run: () => setAiOpen(true) },
    {
      id: 'select',
      label: 'Select visible bookmarks',
      icon: 'check' as IconName,
      run: () => setSelectionMode(true),
    },
    ...(inbox
      ? [
          {
            id: 'inbox',
            label: 'Review Inbox',
            icon: 'inbox' as IconName,
            run: () => setFilter({ kind: 'collection' as const, id: inbox.id }),
          },
        ]
      : []),
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
        onMove={moveToCollection}
        onReorder={collectionsApi.reorder}
        hideCollectionIds={homeOnlyCols}
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

          <AccountMenu email={email} plan={plan} onLogout={logout} />
        </header>

        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-2.5">
          <h1 className="text-sm font-semibold text-ink">{heading}</h1>
          {!isHighlights && <span className="text-xs text-ink-faint">{visibleItems.length} items</span>}

          {!isHighlights && (
            <>
              <button
                className={`btn-outline ml-auto px-2.5 py-1.5 ${selectionMode ? 'border-brand/50 text-brand' : ''}`}
                onClick={toggleSelectionMode}
                disabled={Boolean(bulkBusy)}
                title="Select bookmarks for bulk cleanup"
              >
                <Icon name="check" size={14} /> {selectionMode ? 'Selecting' : 'Select'}
              </button>

              <input
                className="w-48 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-sm outline-none focus:border-brand/50"
                placeholder="Filter results…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSmartSearch()}
              />
              <button
                className="btn-outline px-2.5 py-1.5"
                onClick={runSmartSearch}
                disabled={aiSearching}
                title="Smart search — local relevance with optional AI reranking"
              >
                <Icon name="sparkles" size={15} />
              </button>

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

        {selectionMode && !isHighlights && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            visibleCount={visibleItems.length}
            allVisibleSelected={allVisibleSelected}
            collections={visibleCollections}
            busy={bulkBusy}
            onToggleAll={toggleAllVisible}
            onMove={bulkMove}
            onAddTag={bulkAddTag}
            onFavorite={bulkFavorite}
            onRetryAi={bulkRetryAi}
            onDelete={bulkDelete}
            onDone={finishSelection}
          />
        )}

        {/* Body */}
        <main className="flex-1 overflow-y-auto p-5">
          {isHighlights ? (
            <HighlightsView onCountChange={refreshMeta} />
          ) : aiResults !== null ? (
            <>
              <div className="mb-3 flex items-center gap-2 rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">
                <Icon name="sparkles" size={15} />
                Smart results for “{query}” · {aiResults.length}
                <button className="ml-auto text-xs underline hover:no-underline" onClick={() => setAiResults(null)}>
                  Clear
                </button>
              </div>
              <BookmarkGrid
                items={aiResults}
                loading={aiSearching}
                view={view}
                onDelete={remove}
                onToggleFavorite={fav}
                onEdit={setEditing}
                onRead={setReading}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                onToggleSelected={toggleSelected}
                emptyHint="No smart matches — try rephrasing your search."
              />
            </>
          ) : (
            <BookmarkGrid
              items={items}
              loading={loading}
              view={view}
              onDelete={remove}
              onToggleFavorite={fav}
              onEdit={setEditing}
              onRead={setReading}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
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
        <div
          className="fixed inset-0 z-[2147483645] flex justify-end bg-black/30 backdrop-blur-sm animate-fade-in"
          onClick={() => setAiOpen(false)}
        >
          <div
            className="h-full w-full max-w-md border-l border-line bg-surface animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
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

      {reading && <ReaderView bookmark={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

function AccountMenu({ email, plan, onLogout }: { email: string | null; plan: Plan; onLogout: () => void }) {
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
            <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-xs text-ink-faint">
              <span className="truncate">{email}</span>
              <PlanBadge plan={plan} />
            </div>
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
