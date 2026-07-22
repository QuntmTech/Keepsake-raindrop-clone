import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { currentUser } from '@/lib/auth';
import { readSnapshot, writeSnapshot } from '@/lib/cache';
import { useCollections } from '@/hooks/useCollections';
import { LoginForm } from '@/components/LoginForm';
import { SaveForm } from '@/components/SaveForm';
import { SettingsPanel } from '@/components/SettingsPanel';
import { BookmarkGrid } from '@/components/BookmarkGrid';
import { HighlightsView } from '@/components/HighlightsView';
import { CollectionSidebar, type LibraryFilter } from '@/components/CollectionSidebar';
import { CaptureMenu } from '@/components/CaptureMenu';
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
  homeOnlyCollectionIds,
  watchVault,
} from '@/lib/bookmarks';
import { EditDialog } from '@/components/EditDialog';
import { onboardingStage } from '@/lib/onboarding';
import { Tour, type TourStep } from '@/components/Tour';
import { type Bookmark, type VaultStats } from '@/lib/types';

type RightView = 'list' | 'save' | 'settings';

const POPUP_TOUR: TourStep[] = [
  {
    title: 'Your library lives here',
    body: 'This dropdown is your full bookmark vault — everything you save, on any page, one click from the toolbar.',
  },
  {
    target: '[data-tour="pop-sidebar"]',
    title: 'Collections & filters',
    body: 'Browse by collection, favorites, highlights, or tag. Drag a bookmark onto a collection to file it. Folders that only live on your Home stay out of here.',
  },
  {
    target: '[data-tour="pop-save"]',
    title: 'Save the page you’re on',
    body: 'Hit Save (or press Ctrl+Shift+S anywhere) and Keepsake grabs the title, icon, and preview — AI can even file and tag it for you.',
  },
  {
    target: '[data-tour="pop-capture"]',
    title: 'Screenshots & recordings',
    body: 'Capture the visible area or the full page, or record your tab or screen — saved to Downloads or copied to your clipboard.',
  },
  {
    target: '[data-tour="pop-expand"]',
    title: 'Room to spread out',
    body: 'The full-screen dashboard has the same library with more space — plus import, settings, and stats. That’s the tour. Happy keeping! 🎉',
  },
];

export default function App() {
  const { ready, authed, login, signup } = useAuth();
  const [freshInstall, setFreshInstall] = useState(false);

  useEffect(() => {
    if (authed) send({ type: 'FLUSH_QUEUE' }).catch(() => {});
  }, [authed]);

  useEffect(() => {
    onboardingStage.getValue().then((stage) => setFreshInstall(stage === 'fresh'));
  }, []);

  if (!ready) {
    return (
      <Frame>
        <p className="p-6 text-center text-sm text-ink-faint">Loading…</p>
      </Frame>
    );
  }

  if (!authed) {
    return (
      <Frame narrow>
        <LoginForm onLogin={login} onSignup={signup} compact defaultMode={freshInstall ? 'signup' : 'login'} />
      </Frame>
    );
  }

  return <Vault />;
}

function Vault() {
  const { toast } = useToast();
  const collectionsApi = useCollections(true);
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [right, setRight] = useState<RightView>('list');
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [homeOnlyCols, setHomeOnlyCols] = useState<string[]>([]);
  const [tour, setTour] = useState(false);
  const uidRef = useRef<string | null>(null);
  const collectionsRef = useRef(collectionsApi.collections);
  const countsRef = useRef(collectionsApi.counts);

  useEffect(() => { collectionsRef.current = collectionsApi.collections; }, [collectionsApi.collections]);
  useEffect(() => { countsRef.current = collectionsApi.counts; }, [collectionsApi.counts]);

  useEffect(() => {
    onboardingStage.getValue().then((stage) => {
      if (stage === 'home-done') setTour(true);
    });
  }, []);

  const finishTour = useCallback(() => {
    setTour(false);
    onboardingStage.setValue('complete').catch(() => {});
  }, []);

  const run = useCallback(async () => {
    if (filter.kind === 'highlights') return;
    try {
      const options: Parameters<typeof searchBookmarks>[1] = { perPage: 100 };
      if (filter.kind === 'collection') options.collection = filter.id;
      else if (filter.kind === 'favorites') options.favorite = true;
      else if (filter.kind === 'untagged') options.untagged = true;
      else if (filter.kind === 'tag') options.tag = filter.tag;
      const list = await searchBookmarks(query, options);
      setItems(list);
      if (filter.kind === 'all' && !query.trim()) {
        writeSnapshot({
          uid: uidRef.current ?? '',
          bookmarks: list,
          collections: collectionsRef.current,
          counts: countsRef.current,
        });
      }
    } catch {
      /* keep stale items */
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

  const refreshMeta = useCallback(async () => {
    try {
      const [nextStats, nextTags, hiddenCollections] = await Promise.all([
        vaultStats(),
        getAllTags(),
        homeOnlyCollectionIds(),
      ]);
      setStats(nextStats);
      setTags(nextTags);
      setHomeOnlyCols(hiddenCollections);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      uidRef.current = (await currentUser())?.id ?? null;
      const snapshot = await readSnapshot(uidRef.current);
      if (snapshot) {
        setItems(snapshot.bookmarks.filter((bookmark) => !bookmark.homeOnly));
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const timer = setTimeout(run, 20);
    return () => clearTimeout(timer);
  }, [run]);

  useEffect(() => {
    // Stats/tags are secondary UI. Let cached rows and the primary bookmark query
    // paint first instead of competing for the backend during popup startup.
    const timer = window.setTimeout(refreshMeta, 240);
    return () => window.clearTimeout(timer);
  }, [refreshMeta]);

  useEffect(() => {
    return watchVault(() => {
      run();
      refreshMeta();
      collectionsApi.refresh();
    });
  }, [run, refreshMeta, collectionsApi]);

  async function remove(id: string) {
    await deleteBookmark(id);
    setItems((previous) => previous.filter((bookmark) => bookmark.id !== id));
    refreshMeta();
    collectionsApi.refresh();
    toast('Deleted', 'info');
  }

  async function favorite(bookmark: Bookmark) {
    const updated = await toggleFavorite(bookmark.id, !bookmark.favorite);
    setItems((previous) => previous.map((item) => (item.id === bookmark.id ? updated : item)));
    refreshMeta();
  }

  async function move(bookmarkId: string, collectionId: string | undefined) {
    await updateBookmark(bookmarkId, { collection: collectionId });
    run();
    refreshMeta();
    collectionsApi.refresh();
    const name = collectionId ? collectionsApi.collections.find((item) => item.id === collectionId)?.name : null;
    toast(name ? `Moved to ${name}` : 'Removed from collection', 'success');
  }

  const heading = useMemo(() => {
    if (filter.kind === 'all') return 'All bookmarks';
    if (filter.kind === 'favorites') return 'Favorites';
    if (filter.kind === 'untagged') return 'Unsorted';
    if (filter.kind === 'highlights') return 'Highlights';
    if (filter.kind === 'tag') return `#${filter.tag}`;
    return collectionsApi.collections.find((item) => item.id === filter.id)?.name ?? 'Collection';
  }, [filter, collectionsApi.collections]);

  const saveCollection = useMemo<string | null | undefined>(() => {
    if (filter.kind === 'collection') return filter.id;
    if (filter.kind === 'untagged') return null;
    return undefined;
  }, [filter]);

  return (
    <Frame>
      <div className="flex h-full">
        <CollectionSidebar
          compact
          collections={collectionsApi.collections}
          counts={collectionsApi.counts}
          total={stats?.total ?? 0}
          favorites={stats?.favorites ?? 0}
          highlights={stats?.highlights ?? 0}
          tags={tags}
          selected={filter}
          onSelect={(nextFilter) => {
            setFilter(nextFilter);
            setRight('list');
          }}
          onCreate={collectionsApi.create}
          onRename={collectionsApi.rename}
          onRemove={collectionsApi.remove}
          onMove={move}
          onReorder={collectionsApi.reorder}
          hideCollectionIds={homeOnlyCols}
          dataTour="pop-sidebar"
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
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <button data-tour="pop-save" className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => setRight('save')}>
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

            <div data-tour="pop-capture"><CaptureMenu buttonClass="btn-ghost px-2 py-1.5 text-xs" /></div>
            <button
              className={`btn-ghost px-2 py-1.5 ${right === 'settings' ? 'text-brand' : ''}`}
              onClick={() => setRight((current) => (current === 'settings' ? 'list' : 'settings'))}
              title="Settings"
            >
              <Icon name="settings" size={16} />
            </button>
            <button data-tour="pop-expand" className="btn-ghost px-2 py-1.5" onClick={() => send({ type: 'OPEN_DASHBOARD' })} title="Open full screen">
              <Icon name="external" size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto">
            {right === 'save' && (
              <SaveForm
                initialCollection={saveCollection}
                onSaved={() => {
                  setRight('list');
                  run();
                  refreshMeta();
                  collectionsApi.refresh();
                }}
              />
            )}
            {right === 'settings' && <SettingsPanel compact />}
            {right === 'list' &&
              (filter.kind === 'highlights' ? (
                <div className="p-3"><HighlightsView onCountChange={refreshMeta} /></div>
              ) : (
                <div className="p-3">
                  <div className="mb-2 flex items-center gap-2 px-0.5">
                    <h2 className="text-sm font-semibold">{heading}</h2>
                    <span className="text-xs text-ink-faint">{items.length}</span>
                  </div>
                  <BookmarkGrid items={items} loading={loading} view="list" onDelete={remove} onToggleFavorite={favorite} onEdit={setEditing} />
                </div>
              ))}
          </div>
        </div>
      </div>

      {editing && (
        <EditDialog
          bookmark={editing}
          collections={collectionsApi.collections}
          allTags={tags.map((item) => item.tag)}
          onClose={() => setEditing(null)}
          onSaved={(bookmark) => {
            setItems((previous) => previous.map((item) => (item.id === bookmark.id ? bookmark : item)));
            refreshMeta();
            collectionsApi.refresh();
          }}
        />
      )}
      {tour && <Tour steps={POPUP_TOUR} onDone={finishTour} />}
    </Frame>
  );
}

function Frame({ children, narrow }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className={`flex flex-col bg-surface text-ink ${narrow ? 'w-[24rem]' : 'h-[34rem] w-[47rem]'}`}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white"><Icon name="bookmark" size={16} fill /></span>
        <span className="text-sm font-semibold">Keepsake</span>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
