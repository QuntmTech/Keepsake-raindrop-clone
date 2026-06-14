import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCollections } from '@/hooks/useCollections';
import { LoginForm } from '@/components/LoginForm';
import { SaveForm } from '@/components/SaveForm';
import { SettingsPanel } from '@/components/SettingsPanel';
import { BookmarkGrid } from '@/components/BookmarkGrid';
import { HighlightsView } from '@/components/HighlightsView';
import { CollectionSidebar, type LibraryFilter } from '@/components/CollectionSidebar';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { send } from '@/lib/messaging';
import {
  searchBookmarks,
  deleteBookmark,
  toggleFavorite,
  updateBookmark,
  getAllTags,
  vaultStats,
  watchVault,
} from '@/lib/bookmarks';
import { EditDialog } from '@/components/EditDialog';
import { type Bookmark, type VaultStats } from '@/lib/types';

type RightView = 'list' | 'save' | 'settings';

// The popup is a compact two-pane mini-dashboard: collections on the left,
// your bookmarks on the right, quick-save and settings without leaving the
// dropdown. Full-screen is one click away when you want room to spread out.
export default function App() {
  const { ready, authed, login, signup } = useAuth();

  useEffect(() => {
    if (authed) send({ type: 'FLUSH_QUEUE' }).catch(() => {});
  }, [authed]);

  if (!ready)
    return (
      <Frame>
        <p className="p-6 text-center text-sm text-ink-faint">Loading…</p>
      </Frame>
    );
  if (!authed)
    return (
      <Frame narrow>
        <LoginForm onLogin={login} onSignup={signup} compact />
      </Frame>
    );
  return <Vault />;
}

function Vault() {
  const { toast } = useToast();
  const c = useCollections(true);
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [right, setRight] = useState<RightView>('list');
  const [editing, setEditing] = useState<Bookmark | null>(null);

  const run = useCallback(async () => {
    if (filter.kind === 'highlights') return;
    setLoading(true);
    try {
      const opts: Parameters<typeof searchBookmarks>[1] = { perPage: 100 };
      if (filter.kind === 'collection') opts.collection = filter.id;
      else if (filter.kind === 'favorites') opts.favorite = true;
      else if (filter.kind === 'untagged') opts.untagged = true;
      else if (filter.kind === 'tag') opts.tag = filter.tag;
      setItems(await searchBookmarks(query, opts));
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  const refreshMeta = useCallback(async () => {
    try {
      setStats(await vaultStats());
      setTags(await getAllTags());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(run, 180);
    return () => clearTimeout(id);
  }, [run]);
  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);
  // Live refresh when the vault changes (Quick Bar, shortcut, another tab).
  useEffect(() => {
    return watchVault(() => {
      run();
      refreshMeta();
      c.refresh();
    });
  }, [run, refreshMeta, c]);

  async function remove(id: string) {
    await deleteBookmark(id);
    setItems((p) => p.filter((b) => b.id !== id));
    refreshMeta();
    c.refresh();
    toast('Deleted', 'info');
  }
  async function fav(b: Bookmark) {
    const u = await toggleFavorite(b.id, !b.favorite);
    setItems((p) => p.map((x) => (x.id === b.id ? u : x)));
    refreshMeta();
  }
  async function move(bookmarkId: string, collectionId: string | undefined) {
    await updateBookmark(bookmarkId, { collection: collectionId });
    run();
    refreshMeta();
    c.refresh();
    const name = collectionId ? c.collections.find((x) => x.id === collectionId)?.name : null;
    toast(name ? `Moved to ${name}` : 'Removed from collection', 'success');
  }

  const heading = useMemo(() => {
    if (filter.kind === 'all') return 'All bookmarks';
    if (filter.kind === 'favorites') return 'Favorites';
    if (filter.kind === 'untagged') return 'Unsorted';
    if (filter.kind === 'highlights') return 'Highlights';
    if (filter.kind === 'tag') return `#${filter.tag}`;
    return c.collections.find((x) => x.id === filter.id)?.name ?? 'Collection';
  }, [filter, c.collections]);

  return (
    <Frame>
      <div className="flex h-full">
        <CollectionSidebar
          compact
          collections={c.collections}
          counts={c.counts}
          total={stats?.total ?? 0}
          favorites={stats?.favorites ?? 0}
          highlights={stats?.highlights ?? 0}
          tags={tags}
          selected={filter}
          onSelect={(f) => {
            setFilter(f);
            setRight('list');
          }}
          onCreate={c.create}
          onRename={c.rename}
          onRemove={c.remove}
          onMove={move}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            {right === 'list' ? (
              <>
                <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5">
                  <Icon name="search" size={15} className="text-ink-faint" />
                  <input
                    className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-faint"
                    placeholder={`Search ${heading}…`}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => setRight('save')}>
                  <Icon name="plus" size={15} /> Save
                </button>
              </>
            ) : (
              <>
                <button className="btn-ghost px-2 py-1.5" onClick={() => setRight('list')} title="Back">
                  <Icon name="chevron" size={16} className="rotate-180" />
                </button>
                <span className="flex-1 text-sm font-semibold">{right === 'save' ? 'Save page' : 'Settings'}</span>
              </>
            )}
            <button
              className={`btn-ghost px-2 py-1.5 ${right === 'settings' ? 'text-brand' : ''}`}
              onClick={() => setRight((r) => (r === 'settings' ? 'list' : 'settings'))}
              title="Settings"
            >
              <Icon name="settings" size={16} />
            </button>
            <button className="btn-ghost px-2 py-1.5" onClick={() => send({ type: 'OPEN_DASHBOARD' })} title="Open full screen">
              <Icon name="external" size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            {right === 'save' && (
              <SaveForm
                onSaved={() => {
                  setRight('list');
                  run();
                  refreshMeta();
                  c.refresh();
                }}
              />
            )}
            {right === 'settings' && <SettingsPanel compact />}
            {right === 'list' &&
              (filter.kind === 'highlights' ? (
                <div className="p-3">
                  <HighlightsView onCountChange={refreshMeta} />
                </div>
              ) : (
                <div className="p-3">
                  <div className="mb-2 flex items-center gap-2 px-0.5">
                    <h2 className="text-sm font-semibold">{heading}</h2>
                    <span className="text-xs text-ink-faint">{items.length}</span>
                  </div>
                  <BookmarkGrid items={items} loading={loading} view="list" onDelete={remove} onToggleFavorite={fav} onEdit={setEditing} />
                </div>
              ))}
          </div>
        </div>
      </div>

      {editing && (
        <EditDialog
          bookmark={editing}
          collections={c.collections}
          allTags={tags.map((t) => t.tag)}
          onClose={() => setEditing(null)}
          onSaved={(b) => {
            setItems((p) => p.map((x) => (x.id === b.id ? b : x)));
            refreshMeta();
            c.refresh();
          }}
        />
      )}
    </Frame>
  );
}

function Frame({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className={`flex flex-col bg-surface text-ink ${narrow ? 'w-[24rem]' : 'h-[34rem] w-[47rem]'}`}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white">
          <Icon name="bookmark" size={16} fill />
        </span>
        <span className="text-sm font-semibold">Keepsake</span>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
