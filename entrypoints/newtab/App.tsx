import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from 'wxt/utils/storage';
import { useAuth } from '@/hooks/useAuth';
import { currentUser } from '@/lib/auth';
import { readSnapshot, writeSnapshot } from '@/lib/cache';
import { useSettings } from '@/hooks/useSettings';
import { useCollections } from '@/hooks/useCollections';
import { LoginForm } from '@/components/LoginForm';
import { AddDialog } from '@/components/AddDialog';
import { AppCatalog } from '@/components/AppCatalog';
import { CaptureMenu } from '@/components/CaptureMenu';
import { EditDialog } from '@/components/EditDialog';
import { Favicon } from '@/components/Favicon';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { searchBookmarks, updateBookmark, deleteBookmark, getAllTags, markVisited, watchVault } from '@/lib/bookmarks';
import { syncHomeOverlay, watchHomeOverlay } from '@/lib/home';
import { parseNetscapeHtml, parseKeepsakeJson, importItems } from '@/lib/importer';
import { WALLPAPERS, wallpaperCss } from '@/lib/wallpaper';
import { SEARCH_ENGINES, searchUrl } from '@/lib/search';
import { normUrl } from '@/lib/apps';
import { type Bookmark, type Collection } from '@/lib/types';

const TILE_MIME = 'application/x-keepsake-tile';
const SHELF_MIME = 'application/x-keepsake-shelf';
const seenHelp = storage.defineItem<boolean>('local:seen_home_help', { fallback: false });
// Which Home sections the user has collapsed (persisted per device).
const collapsedStore = storage.defineItem<string[]>('local:home_collapsed', { fallback: [] });

interface Section {
  key: string; // 'fav', 'quick', or collection id
  title: string;
  color?: string;
  items: Bookmark[];
}

// Keepsake Home — an editable start page: add/edit tiles, drag to rearrange and
// group into collections, search your vault, import links.
export default function App() {
  const { ready, authed, email, login, signup } = useAuth();
  const { settings, update } = useSettings();
  const c = useCollections(authed);
  const { toast } = useToast();
  const [wallOpen, setWallOpen] = useState(false);

  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Bookmark[] | null>(null);
  const [all, setAll] = useState<Bookmark[]>([]);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [draggingTile, setDraggingTile] = useState<string | null>(null);
  const [addTo, setAddTo] = useState<{ favorite?: boolean; collection?: string } | null>(null);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; value: string } | null>(null);
  const [help, setHelp] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const uidRef = useRef<string | null>(null);

  const reloadAll = useCallback(() => {
    // Keep current links on screen if the request is slow/fails — never blank out.
    // homeTiles: 'include' — catalog app tiles are hidden from the library but ARE Home.
    searchBookmarks('', { perPage: 500, homeTiles: 'include' }).then(setAll).catch(() => {});
    getAllTags().then((t) => setAllTags(t.map((x) => x.tag))).catch(() => {});
  }, []);

  // Paint cached links instantly on open, then refresh.
  useEffect(() => {
    (async () => {
      uidRef.current = (await currentUser())?.id ?? null;
      const snap = await readSnapshot(uidRef.current);
      if (snap && snap.bookmarks.length) setAll((cur) => (cur.length ? cur : snap.bookmarks));
    })();
  }, []);

  // Keep the snapshot fresh for the next instant open.
  useEffect(() => {
    if (all.length) {
      writeSnapshot({ uid: uidRef.current ?? '', bookmarks: all, collections: c.collections, counts: c.counts });
    }
  }, [all, c.collections, c.counts]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (authed) reloadAll();
  }, [authed, reloadAll]);
  // Retry pushing overlay-held pin state to the server (heals once the
  // PocketBase schema gains the pinned/sort/homeOnly fields), then repaint.
  useEffect(() => {
    if (!authed) return;
    syncHomeOverlay().then(reloadAll).catch(() => {});
  }, [authed, reloadAll]);
  useEffect(() => {
    collapsedStore.getValue().then(setCollapsedKeys);
  }, []);
  const toggleCollapsed = (key: string) => {
    setCollapsedKeys((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      collapsedStore.setValue(next);
      return next;
    });
  };

  // Show the setup guide once.
  useEffect(() => {
    if (!authed) return;
    seenHelp.getValue().then((seen) => {
      if (!seen) {
        setHelp(true);
        seenHelp.setValue(true);
      }
    });
  }, [authed]);
  useEffect(() => {
    if (!authed) return;
    const unVault = watchVault(() => {
      reloadAll();
      c.refresh();
    });
    // Pins can also change via the overlay alone (e.g. added from the popup
    // while this tab is open) — that write never touches the vault stores.
    const unOverlay = watchHomeOverlay(reloadAll);
    return () => {
      unVault();
      unOverlay();
    };
  }, [authed, reloadAll, c]);

  useEffect(() => {
    if (!authed) return;
    const id = setTimeout(() => {
      const q = query.trim();
      if (!q) return setResults(null);
      searchBookmarks(q, { perPage: 40, homeTiles: 'include' }).then(setResults).catch(() => setResults([]));
    }, 150);
    return () => clearTimeout(id);
  }, [query, authed]);

  const byOrder = (a: Bookmark, b: Bookmark) =>
    (a.sort ?? 1e9) - (b.sort ?? 1e9) || b.created.localeCompare(a.created);

  // Home is CURATED: only bookmarks pinned to Home show up here — your full
  // library lives in the dashboard, untouched.
  const pinnedItems = useMemo(() => all.filter((b) => b.pinned), [all]);

  const sections: Section[] = useMemo(() => {
    const favs: Section = {
      key: 'fav',
      title: 'Favorites',
      items: pinnedItems.filter((b) => b.favorite).sort(byOrder),
    };
    // Pinned links that aren't favorites and aren't filed anywhere.
    const loose = pinnedItems.filter((b) => !b.favorite && !b.collection).sort(byOrder);
    // While a tile is mid-drag, Quick links is always a valid drop target —
    // it's how you drag a tile OUT of a collection.
    const quick: Section[] =
      loose.length || draggingTile ? [{ key: 'quick', title: 'Quick links', items: loose }] : [];
    // Collection shelves with pinned links; while dragging, show them all so
    // any collection can receive the tile.
    const cols: Section[] = c.collections
      .map((col: Collection) => ({
        key: col.id,
        title: col.name,
        color: col.color,
        items: pinnedItems.filter((b) => b.collection === col.id && !b.favorite).sort(byOrder),
      }))
      .filter((s) => s.items.length > 0 || draggingTile !== null);
    return [favs, ...quick, ...cols];
  }, [pinnedItems, c.collections, draggingTile]);

  const greeting = useMemo(() => {
    const h = now.getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, [now]);
  const name = email ? email.split('@')[0] : '';
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const open = (b: Bookmark) => {
    markVisited(b.id);
    window.location.href = b.url;
  };
  const webSearch = () => {
    window.location.href = searchUrl(settings.searchEngine, query);
  };

  // Drop a tile into a section, optionally before a specific tile; reindex order.
  // Paints the result immediately (optimistic), then persists every position.
  async function dropTile(bmId: string, sectionKey: string, beforeId?: string) {
    const section = sections.find((s) => s.key === sectionKey);
    if (!section) return;
    const ids = section.items.map((b) => b.id).filter((id) => id !== bmId);
    let at = beforeId ? ids.indexOf(beforeId) : ids.length;
    if (at < 0) at = ids.length;
    ids.splice(at, 0, bmId);
    // Dropping onto a shelf pins the link to Home and sets its shelf.
    const membership: Partial<Bookmark> =
      sectionKey === 'fav'
        ? { favorite: true, pinned: true }
        : sectionKey === 'quick'
          ? { favorite: false, collection: undefined, pinned: true }
          : { favorite: false, collection: sectionKey, pinned: true };
    setAll((cur) =>
      cur.map((b) => {
        const i = ids.indexOf(b.id);
        if (i < 0) return b;
        return b.id === bmId ? { ...b, ...membership, sort: i } : { ...b, sort: i };
      }),
    );
    try {
      await Promise.all(
        ids.map((id, i) => updateBookmark(id, id === bmId ? { ...membership, sort: i } : { sort: i })),
      );
    } catch {
      toast('Could not save the new order', 'error');
    }
    reloadAll();
  }

  // Move a collection shelf before another shelf (or to the end of the list).
  async function dropShelf(dragId: string, targetKey: string) {
    if (dragId === targetKey) return;
    const ids = c.collections.map((x) => x.id).filter((id) => id !== dragId);
    const at = ids.indexOf(targetKey);
    ids.splice(at < 0 ? ids.length : at, 0, dragId);
    try {
      await c.reorder(ids);
    } catch {
      toast('Could not save the shelf order', 'error');
    }
  }

  async function removeFromHome(b: Bookmark) {
    if (b.homeOnly) {
      // Catalog app tiles exist only for Home — removing the tile deletes it.
      await deleteBookmark(b.id);
    } else {
      // Unpin from Home only — the bookmark stays in your library untouched.
      await updateBookmark(b.id, { pinned: false });
    }
    reloadAll();
  }

  async function renameCollection(id: string, name: string) {
    const clean = name.trim();
    setRenaming(null);
    if (!clean) return;
    try {
      await c.rename(id, { name: clean });
      toast('Collection renamed', 'success');
    } catch {
      toast('Could not rename the collection', 'error');
    }
  }

  // Delete a whole collection from Home: its catalog-only tiles are deleted,
  // real library bookmarks are just unpinned (and survive in the dashboard).
  async function deleteCollectionFromHome(s: Section) {
    const ok = window.confirm(
      `Delete the “${s.title}” collection and remove its ${s.items.length} tile${s.items.length === 1 ? '' : 's'} from Home?\n\nBookmarks saved in your library are kept.`,
    );
    if (!ok) return;
    try {
      await Promise.all(
        s.items.map((b) => (b.homeOnly ? deleteBookmark(b.id) : updateBookmark(b.id, { pinned: false }))),
      );
      await c.remove(s.key);
      toast(`Deleted ${s.title}`, 'success');
    } catch {
      toast('Could not delete the collection', 'error');
    }
    reloadAll();
  }

  // One-click bootstrap: pin everything you've already favorited.
  async function pinAllFavorites() {
    const favs = all.filter((b) => b.favorite && !b.pinned);
    if (!favs.length) {
      toast('No favorites to pin yet — use + to add links', 'info');
      return;
    }
    try {
      await Promise.all(favs.map((b) => updateBookmark(b.id, { pinned: true })));
      toast(`Pinned ${favs.length} favorite${favs.length === 1 ? '' : 's'} to Home`, 'success');
    } catch {
      toast('Could not pin favorites — check your connection', 'error');
    }
    reloadAll();
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const items = file.name.endsWith('.json') ? parseKeepsakeJson(text) : parseNetscapeHtml(text);
    if (!items.length) {
      toast('No links found in that file', 'error');
      return;
    }
    toast(`Importing ${items.length}…`, 'info');
    const res = await importItems(items, undefined);
    toast(`Imported ${res.done - res.failed} links`, 'success');
    reloadAll();
    c.refresh();
    if (fileRef.current) fileRef.current.value = '';
  }

  if (!ready) return <div className="grid h-screen place-items-center text-ink-faint">Loading…</div>;
  if (!authed)
    return (
      <div className="grid min-h-screen place-items-center bg-surface-sunken">
        <div className="card w-full max-w-sm">
          <LoginForm onLogin={login} onSignup={signup} />
        </div>
      </div>
    );

  const minimal = settings.newTabMode === 'minimal';
  const wall = wallpaperCss(settings.wallpaper);
  const onWall = Boolean(wall);
  // Shelf panels: solid cards normally, frosted glass over a wallpaper.
  const panelCls = onWall
    ? 'border-white/15 bg-surface-raised/90 backdrop-blur-md'
    : 'border-line bg-surface-raised shadow-card';

  const Tile = ({ b, sectionKey }: { b: Bookmark; sectionKey: string }) => (
    <div
      className={`group relative flex min-h-[76px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-surface p-2 transition hover:-translate-y-0.5 hover:shadow-card ${
        dropKey === `${sectionKey}:${b.id}` ? 'border-brand ring-2 ring-brand' : 'border-line hover:border-brand/40'
      } ${draggingTile === b.id ? 'opacity-40' : ''}`}
      draggable
      onClick={() => open(b)}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(TILE_MIME, b.id);
        e.dataTransfer.effectAllowed = 'move';
        setDraggingTile(b.id);
      }}
      onDragEnd={() => {
        setDraggingTile(null);
        setDropKey(null);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TILE_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setDropKey(`${sectionKey}:${b.id}`);
      }}
      onDragLeave={() => setDropKey((k) => (k === `${sectionKey}:${b.id}` ? null : k))}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = e.dataTransfer.getData(TILE_MIME);
        setDropKey(null);
        if (id && id !== b.id) dropTile(id, sectionKey, b.id);
      }}
      title={b.title}
    >
      <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
        <button
          className="rounded-md bg-surface/80 p-1 text-ink-faint backdrop-blur hover:text-brand"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(b);
          }}
          title="Edit"
        >
          <Icon name="edit" size={12} />
        </button>
        <button
          className="rounded-md bg-surface/80 p-1 text-ink-faint backdrop-blur hover:text-red-500"
          onClick={(e) => {
            e.stopPropagation();
            removeFromHome(b);
          }}
          title={b.homeOnly ? 'Remove from Home' : 'Remove from Home (bookmark stays in your library)'}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <Favicon src={b.favicon} size={28} label={b.title} />
      <span className="line-clamp-2 max-w-full text-center text-[11px] leading-tight text-ink-soft">{b.title}</span>
    </div>
  );

  // Compact "shelf" panel — Atlas-style folder card, no giant banner.
  const SectionBlock = ({ s }: { s: Section }) => {
    const isCollapsed = collapsedKeys.includes(s.key) && !draggingTile;
    const isCollection = s.key !== 'fav' && s.key !== 'quick';
    const dashHash = s.key === 'fav' ? '#favorites' : `#c=${s.key}`;
    return (
      <section
        className={`group/shelf rounded-2xl border p-3.5 transition ${panelCls} ${s.key === 'fav' ? 'lg:col-span-2' : ''} ${
          dropKey === s.key ? 'ring-2 ring-brand' : ''
        }`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TILE_MIME) && !e.dataTransfer.types.includes(SHELF_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropKey(s.key);
        }}
        onDragLeave={() => setDropKey((k) => (k === s.key ? null : k))}
        onDrop={(e) => {
          e.preventDefault();
          setDropKey(null);
          const shelfId = e.dataTransfer.getData(SHELF_MIME);
          if (shelfId && isCollection) {
            dropShelf(shelfId, s.key);
            return;
          }
          const id = e.dataTransfer.getData(TILE_MIME);
          if (id) dropTile(id, s.key);
        }}
      >
        <div className="flex items-center gap-2">
          {isCollection && (
            <span
              draggable
              className="cursor-grab rounded p-0.5 text-ink-faint opacity-0 transition hover:bg-surface-sunken group-hover/shelf:opacity-100"
              onDragStart={(e) => {
                e.stopPropagation();
                e.dataTransfer.setData(SHELF_MIME, s.key);
                e.dataTransfer.effectAllowed = 'move';
              }}
              title="Drag to reorder collections"
            >
              <Icon name="grip" size={12} />
            </span>
          )}
          {s.key === 'fav' ? (
            <Icon name="star-fill" size={14} className="shrink-0 text-amber-400" />
          ) : (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color || 'rgb(var(--accent))' }} />
          )}
          {renaming?.key === s.key ? (
            <input
              className="input flex-1 px-2 py-0.5 text-sm"
              value={renaming.value}
              autoFocus
              onChange={(e) => setRenaming({ key: s.key, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') renameCollection(s.key, renaming.value);
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={() => renameCollection(s.key, renaming.value)}
            />
          ) : (
            <a
              href={browser.runtime.getURL('/dashboard.html') + dashHash}
              className="truncate text-sm font-semibold text-ink hover:text-brand"
              title="Open in dashboard"
            >
              {s.key === 'fav' ? 'Favorites' : s.title}
            </a>
          )}
          <span className="rounded-full bg-surface-sunken px-1.5 text-[11px] text-ink-faint">{s.items.length}</span>
          <div className="ml-auto flex items-center gap-0.5">
            {isCollection && renaming?.key !== s.key && (
              <>
                <button
                  className="rounded-md p-1 text-ink-faint hover:bg-surface-sunken hover:text-brand"
                  onClick={() => setRenaming({ key: s.key, value: s.title })}
                  title="Rename collection"
                >
                  <Icon name="edit" size={13} />
                </button>
                <button
                  className="rounded-md p-1 text-ink-faint hover:bg-surface-sunken hover:text-red-500"
                  onClick={() => deleteCollectionFromHome(s)}
                  title="Delete collection (removes its tiles from Home)"
                >
                  <Icon name="trash" size={13} />
                </button>
              </>
            )}
            <button
              className="rounded-md p-1 text-ink-faint hover:bg-surface-sunken hover:text-brand"
              onClick={() => setAddTo(s.key === 'fav' ? { favorite: true } : isCollection ? { collection: s.key } : {})}
              title="Add a link here"
            >
              <Icon name="plus" size={15} />
            </button>
            <button
              className="rounded-md p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink"
              onClick={() => toggleCollapsed(s.key)}
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              <Icon name="chevron" size={14} className={`transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
            </button>
          </div>
        </div>

        {!isCollapsed && (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2.5">
            {s.items.map((b) => (
              <Tile key={b.id} b={b} sectionKey={s.key} />
            ))}
            {s.items.length === 0 && draggingTile && (
              <div className="col-span-full grid min-h-[76px] place-items-center rounded-xl border border-dashed border-brand/40 text-xs text-ink-faint">
                Drop here
              </div>
            )}
            <button
              className="flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-ink-faint transition hover:border-brand/50 hover:text-brand"
              onClick={() => setAddTo(s.key === 'fav' ? { favorite: true } : isCollection ? { collection: s.key } : {})}
            >
              <Icon name="plus" size={16} />
              <span className="text-[10px]">Add</span>
            </button>
          </div>
        )}
      </section>
    );
  };

  const headBtn = `btn-ghost px-2 ${onWall ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`;

  return (
    <div
      className={`relative min-h-screen text-ink ${onWall ? '' : 'bg-surface-sunken'}`}
      style={onWall ? { background: wall, backgroundAttachment: 'fixed' } : undefined}
    >
      {onWall && <div className="pointer-events-none fixed inset-0 bg-black/35" />}
      <div className="relative">
      <header className="flex items-center gap-2 px-6 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
          <Icon name="bookmark" size={17} fill />
        </span>
        <span className={`text-base font-semibold ${onWall ? 'text-white drop-shadow' : ''}`}>Keepsake</span>
        <div className="ml-auto flex items-center gap-1.5">
          <input ref={fileRef} type="file" accept=".html,.json" className="hidden" onChange={onFile} />
          <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => setCatalogOpen(true)} title="Add apps to your Home">
            <Icon name="plus" size={15} /> Add apps
          </button>
          <CaptureMenu buttonClass={`btn-ghost px-2.5 text-sm ${onWall ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`} />
          <button className={`btn-ghost px-2.5 text-sm ${onWall ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`} onClick={() => fileRef.current?.click()} title="Import links">
            <Icon name="import" size={17} /> Import
          </button>
          <div className="relative">
            <button className={headBtn} onClick={() => setWallOpen((o) => !o)} title="Wallpaper">
              <Icon name="image" size={18} />
            </button>
            {wallOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setWallOpen(false)} />
                <div className="absolute right-0 top-10 z-20 w-60 rounded-xl border border-line bg-surface-raised p-3 shadow-float">
                  <p className="mb-2 text-xs font-semibold text-ink-soft">Wallpaper</p>
                  <div className="grid grid-cols-4 gap-2">
                    {WALLPAPERS.map((w) => (
                      <button
                        key={w.key}
                        className={`h-10 rounded-lg border ${settings.wallpaper === w.key ? 'border-brand ring-2 ring-brand' : 'border-line'}`}
                        style={{ background: w.css || 'rgb(var(--surface-sunken))' }}
                        onClick={() => update({ wallpaper: w.key })}
                        title={w.label}
                      />
                    ))}
                  </div>
                  <input
                    className="input mt-2 text-xs"
                    placeholder="Custom image URL…"
                    defaultValue={settings.wallpaper.startsWith('url:') ? settings.wallpaper.slice(4) : ''}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value.trim();
                        update({ wallpaper: v ? `url:${v}` : '' });
                        setWallOpen(false);
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>
          <button className={headBtn} onClick={() => setHelp(true)} title="Help & setup">
            <span className="grid h-5 w-5 place-items-center rounded-full border border-current text-xs font-bold">?</span>
          </button>
          <a className={headBtn} href={browser.runtime.getURL('/dashboard.html')} title="Open dashboard">
            <Icon name="grid" size={18} />
          </a>
          <button className={headBtn} onClick={() => browser.runtime.openOptionsPage()} title="Settings">
            <Icon name="settings" size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 pb-24">
        <div className="mt-[4vh] text-center">
          <p className={`text-5xl font-semibold tracking-tight ${onWall ? 'text-white drop-shadow-lg' : ''}`}>{time}</p>
          <p className={`mt-2 text-lg ${onWall ? 'text-white/90 drop-shadow' : 'text-ink-soft'}`}>
            {greeting}
            {name ? `, ${name}` : ''}.
          </p>
        </div>

        <div className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border border-line bg-surface-raised px-4 py-3 shadow-card focus-within:border-brand/50">
          <Icon name="search" size={20} className="text-ink-faint" />
          <input
            className="flex-1 bg-transparent text-base outline-none placeholder:text-ink-faint"
            placeholder="Search your vault — or press Enter to search the web"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim() && (!results || results.length === 0)) webSearch();
            }}
          />
          <select
            className="cursor-pointer bg-transparent text-xs text-ink-faint outline-none"
            value={settings.searchEngine}
            onChange={(e) => update({ searchEngine: e.target.value as typeof settings.searchEngine })}
            title="Web search engine"
          >
            {SEARCH_ENGINES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {query && (
            <button className="text-xs text-ink-faint hover:text-brand" onClick={webSearch}>
              Search ↗
            </button>
          )}
        </div>

        {results !== null ? (
          <div className="mt-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">Results for “{query}”</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
              {results.map((b) => (
                <Tile key={b.id} b={b} sectionKey={b.favorite ? 'fav' : b.collection ?? 'fav'} />
              ))}
              {results.length === 0 && (
                <p className="col-span-full py-6 text-center text-sm text-ink-faint">
                  Nothing saved — press Enter to search the web.
                </p>
              )}
            </div>
          </div>
        ) : pinnedItems.length === 0 ? (
          /* Curated-Home bootstrap: nothing pinned yet */
          <div className={`mx-auto mt-10 max-w-lg rounded-2xl border p-8 text-center ${panelCls}`}>
            <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-brand/10 text-brand">
              <Icon name="star" size={24} />
            </span>
            <h2 className="text-base font-semibold text-ink">Build your Home screen</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
              Home only shows links you <b>pin</b> — your full bookmark library stays separate in the
              dashboard. Add the sites you actually open every day.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button className="btn-primary" onClick={() => setCatalogOpen(true)}>
                <Icon name="grid" size={16} /> Browse popular apps
              </button>
              <button className="btn-outline" onClick={() => setAddTo({ favorite: true })}>
                <Icon name="plus" size={15} /> Custom link
              </button>
              <button className="btn-outline" onClick={pinAllFavorites}>
                <Icon name="star" size={15} /> Pin all my favorites
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {(minimal ? sections.slice(0, 1) : sections).map((s) => (
              <SectionBlock key={s.key} s={s} />
            ))}
          </div>
        )}
      </main>

      {addTo && (
        <AddDialog
          collections={c.collections}
          allTags={allTags}
          defaultCollection={addTo.collection}
          favorite={addTo.favorite}
          pinned
          onClose={() => setAddTo(null)}
          onAdded={() => {
            reloadAll();
            c.refresh();
          }}
        />
      )}
      {editing && (
        <EditDialog
          bookmark={editing}
          collections={c.collections}
          allTags={allTags}
          onClose={() => setEditing(null)}
          onSaved={() => {
            reloadAll();
            c.refresh();
          }}
        />
      )}
      {catalogOpen && (
        <AppCatalog
          pinnedUrls={new Set(pinnedItems.map((b) => normUrl(b.url)))}
          onClose={() => setCatalogOpen(false)}
          onCustom={() => {
            setCatalogOpen(false);
            setAddTo({ favorite: true });
          }}
          onChanged={() => {
            reloadAll();
            c.refresh();
          }}
        />
      )}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      </div>
    </div>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[2147483646] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Make Keepsake your home</h3>
          <button className="btn-ghost px-2" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <ol className="space-y-2 text-sm text-ink-soft">
          <li>
            <b>1. Home is curated:</b> it only shows links you <b>pin</b> — your full bookmark library
            stays separate in the dashboard.
          </li>
          <li><b>2. Add apps:</b> hit <b>“Add apps”</b> (top bar) for one-click popular apps with icons — or add a whole category at once with <b>“+ Add collection”</b>.</li>
          <li><b>3. Edit a tile:</b> hover → pencil: change title, icon (paste URL or upload an image), or folder.</li>
          <li><b>4. Rearrange:</b> drag tiles to reorder, drop onto another shelf to move them in or out of collections, and drag a shelf’s grip to reorder collections. The ✕ removes a tile from Home.</li>
          <li><b>5. Pin from the library:</b> edit any bookmark → “Show on Home screen”.</li>
          <li>
            <b>6. Make this your homepage:</b> Chrome → <i>Settings → On startup</i> → “Open the New Tab
            page”, and turn on the <i>Home button</i> (Appearance) set to New Tab.
          </li>
          <li><b>7. Search:</b> type to search your vault; press <b>Enter</b> to search the web (engine picker on the right).</li>
        </ol>
        <button className="btn-primary mt-4 w-full" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
