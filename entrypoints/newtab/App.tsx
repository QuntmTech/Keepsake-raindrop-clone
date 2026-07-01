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
const FOLDER_MIME = 'application/x-keepsake-folder';
const seenHelp = storage.defineItem<boolean>('local:seen_home_help', { fallback: false });

// Keepsake Home — an Atlas-style launcher: one compact icon grid. Loose apps
// are single tiles; collections are folder tiles that open a popup. Drag to
// rearrange, drop a tile onto a folder to file it, search your vault on top.
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
  const [renaming, setRenaming] = useState<string | null>(null);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
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

  // Escape closes the folder popup first, then any open pickers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenFolder(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const byOrder = (a: Bookmark, b: Bookmark) =>
    (a.sort ?? 1e9) - (b.sort ?? 1e9) || b.created.localeCompare(a.created);

  // Home is CURATED: only bookmarks pinned to Home show up here — your full
  // library lives in the dashboard, untouched.
  const pinnedItems = useMemo(() => all.filter((b) => b.pinned), [all]);

  const colIds = useMemo(() => new Set(c.collections.map((x) => x.id)), [c.collections]);
  // Single tiles: pinned links not filed into any (existing) collection.
  const looseTiles = useMemo(
    () => pinnedItems.filter((b) => !b.collection || !colIds.has(b.collection)).sort(byOrder),
    [pinnedItems, colIds],
  );
  // Folder tiles: collections that hold at least one pinned link.
  const folders = useMemo(
    () =>
      c.collections
        .map((col: Collection) => ({
          col,
          items: pinnedItems.filter((b) => b.collection === col.id).sort(byOrder),
        }))
        .filter((f) => f.items.length > 0),
    [pinnedItems, c.collections],
  );
  const folderItems = useCallback(
    (colId: string) => folders.find((f) => f.col.id === colId)?.items ?? [],
    [folders],
  );

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

  // Drop a tile into a container ('loose' grid or a collection id), optionally
  // before a specific tile. Paints the result immediately, then persists.
  async function dropTile(bmId: string, target: string, beforeId?: string) {
    const list = (target === 'loose' ? looseTiles : folderItems(target)).map((b) => b.id).filter((id) => id !== bmId);
    let at = beforeId ? list.indexOf(beforeId) : list.length;
    if (at < 0) at = list.length;
    list.splice(at, 0, bmId);
    // Filing into a folder sets the collection; dropping on the grid clears it.
    // The favorite flag is left alone — it only matters in the dashboard now.
    const membership: Partial<Bookmark> =
      target === 'loose' ? { collection: undefined, pinned: true } : { collection: target, pinned: true };
    setAll((cur) =>
      cur.map((b) => {
        const i = list.indexOf(b.id);
        if (i < 0) return b;
        return b.id === bmId ? { ...b, ...membership, sort: i } : { ...b, sort: i };
      }),
    );
    try {
      await Promise.all(
        list.map((id, i) => updateBookmark(id, id === bmId ? { ...membership, sort: i } : { sort: i })),
      );
    } catch {
      toast('Could not save the new order', 'error');
    }
    reloadAll();
  }

  // Move a folder before another folder ('' = to the end of the grid).
  async function dropFolder(dragId: string, targetId: string) {
    if (dragId === targetId) return;
    const ids = c.collections.map((x) => x.id).filter((id) => id !== dragId);
    const at = targetId ? ids.indexOf(targetId) : -1;
    ids.splice(at < 0 ? ids.length : at, 0, dragId);
    try {
      await c.reorder(ids);
    } catch {
      toast('Could not save the folder order', 'error');
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

  async function renameCollection(id: string, nameRaw: string) {
    const clean = nameRaw.trim();
    setRenaming(null);
    if (!clean) return;
    try {
      await c.rename(id, { name: clean });
      toast('Folder renamed', 'success');
    } catch {
      toast('Could not rename the folder', 'error');
    }
  }

  // Delete a whole folder from Home: its catalog-only tiles are deleted,
  // real library bookmarks are just unpinned (and survive in the dashboard).
  async function deleteFolderFromHome(col: Collection, items: Bookmark[]) {
    const ok = window.confirm(
      `Delete the “${col.name}” folder and remove its ${items.length} tile${items.length === 1 ? '' : 's'} from Home?\n\nBookmarks saved in your library are kept.`,
    );
    if (!ok) return;
    setOpenFolder(null);
    try {
      await Promise.all(
        items.map((b) => (b.homeOnly ? deleteBookmark(b.id) : updateBookmark(b.id, { pinned: false }))),
      );
      await c.remove(col.id);
      toast(`Deleted ${col.name}`, 'success');
    } catch {
      toast('Could not delete the folder', 'error');
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
  // Panels: solid cards normally, frosted glass over a wallpaper.
  const panelCls = onWall
    ? 'border-white/15 bg-surface-raised/90 backdrop-blur-md'
    : 'border-line bg-surface-raised shadow-card';
  const iconCls = onWall
    ? 'border-white/20 bg-surface-raised/95 backdrop-blur-md'
    : 'border-line bg-surface-raised shadow-card';
  const labelCls = onWall ? 'text-white/90 drop-shadow' : 'text-ink-soft';

  // A single app tile: icon square + label, Atlas-sized. `statik` disables
  // drag & drop (used in search results, where reordering has no meaning).
  const Tile = ({ b, container, statik }: { b: Bookmark; container: string; statik?: boolean }) => {
    const dk = `tile:${container}:${b.id}`;
    return (
      <div
        className={`group relative flex w-[92px] cursor-pointer flex-col items-center gap-1.5 ${
          draggingTile === b.id ? 'opacity-40' : ''
        }`}
        draggable={!statik}
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
          if (statik || !e.dataTransfer.types.includes(TILE_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          setDropKey(dk);
        }}
        onDragLeave={() => setDropKey((k) => (k === dk ? null : k))}
        onDrop={(e) => {
          if (statik) return;
          e.preventDefault();
          e.stopPropagation();
          const id = e.dataTransfer.getData(TILE_MIME);
          setDropKey(null);
          if (id && id !== b.id) dropTile(id, container, b.id);
        }}
        title={b.title}
      >
        <div
          className={`grid h-16 w-16 place-items-center overflow-hidden rounded-2xl border transition group-hover:-translate-y-0.5 group-hover:shadow-float ${
            dropKey === dk ? 'border-brand ring-2 ring-brand' : iconCls
          }`}
        >
          <Favicon src={b.favicon} size={34} label={b.title} />
        </div>
        <div className="absolute -right-1 -top-1 z-10 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
          <button
            className="grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-ink-faint shadow-card hover:text-brand"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(b);
            }}
            title="Edit"
          >
            <Icon name="edit" size={10} />
          </button>
          <button
            className="grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-ink-faint shadow-card hover:text-red-500"
            onClick={(e) => {
              e.stopPropagation();
              removeFromHome(b);
            }}
            title={b.homeOnly ? 'Remove from Home' : 'Remove from Home (bookmark stays in your library)'}
          >
            <Icon name="close" size={10} />
          </button>
        </div>
        <span className={`line-clamp-1 max-w-[92px] text-center text-[11px] leading-tight ${labelCls}`}>{b.title}</span>
      </div>
    );
  };

  // A folder tile: mini 2×2 icon preview. Click opens the folder popup;
  // drop a tile on it to file the tile into the collection.
  const FolderTile = ({ col, items }: { col: Collection; items: Bookmark[] }) => {
    const dk = `folder:${col.id}`;
    return (
      <div
        className="group relative flex w-[92px] cursor-pointer flex-col items-center gap-1.5"
        draggable
        onClick={() => setOpenFolder(col.id)}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(FOLDER_MIME, col.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          const t = e.dataTransfer.types;
          if (!t.includes(TILE_MIME) && !t.includes(FOLDER_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          setDropKey(dk);
        }}
        onDragLeave={() => setDropKey((k) => (k === dk ? null : k))}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropKey(null);
          const fid = e.dataTransfer.getData(FOLDER_MIME);
          if (fid) {
            dropFolder(fid, col.id);
            return;
          }
          const id = e.dataTransfer.getData(TILE_MIME);
          if (id) dropTile(id, col.id);
        }}
        title={`${col.name} — ${items.length} app${items.length === 1 ? '' : 's'}`}
      >
        <div
          className={`grid h-16 w-16 grid-cols-2 content-center justify-items-center gap-1 rounded-2xl border p-2 transition group-hover:-translate-y-0.5 group-hover:shadow-float ${
            dropKey === dk ? 'border-brand ring-2 ring-brand' : iconCls
          }`}
        >
          {items.slice(0, 4).map((b) => (
            <span key={b.id} className="grid h-6 w-6 place-items-center overflow-hidden rounded-md bg-surface-sunken">
              <Favicon src={b.favicon} size={17} label={b.title} />
            </span>
          ))}
        </div>
        <span className={`line-clamp-1 max-w-[92px] text-center text-[11px] leading-tight ${labelCls}`}>{col.name}</span>
      </div>
    );
  };

  const openFolderData = openFolder
    ? {
        col: c.collections.find((x) => x.id === openFolder),
        items: pinnedItems.filter((b) => b.collection === openFolder).sort(byOrder),
      }
    : null;

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

      <main className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="mt-[4vh] text-center">
          <p className={`text-5xl font-semibold tracking-tight ${onWall ? 'text-white drop-shadow-lg' : ''}`}>{time}</p>
          <p className={`mt-2 text-lg ${onWall ? 'text-white/90 drop-shadow' : 'text-ink-soft'}`}>
            {greeting}
            {name ? `, ${name}` : ''}.
          </p>
        </div>

        <div className={`mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border px-4 py-3 focus-within:border-brand/50 ${panelCls}`}>
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
          <div className="mt-10">
            <h2 className={`mb-4 text-center text-xs font-semibold uppercase tracking-wide ${onWall ? 'text-white/80' : 'text-ink-faint'}`}>
              Results for “{query}”
            </h2>
            <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-5">
              {results.map((b) => (
                <Tile key={b.id} b={b} container="results" statik />
              ))}
              {results.length === 0 && (
                <p className={`py-6 text-center text-sm ${onWall ? 'text-white/80' : 'text-ink-faint'}`}>
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
              <button className="btn-outline" onClick={() => setAddTo({})}>
                <Icon name="plus" size={15} /> Custom link
              </button>
              <button className="btn-outline" onClick={pinAllFavorites}>
                <Icon name="star" size={15} /> Pin all my favorites
              </button>
            </div>
          </div>
        ) : minimal ? null : (
          /* The launcher grid: single apps first, then folders, then Add. */
          <div
            className={`mt-12 flex flex-wrap items-start justify-center gap-x-2 gap-y-6 rounded-3xl p-3 transition ${
              dropKey === 'grid' ? 'outline-dashed outline-2 outline-brand/50' : ''
            }`}
            onDragOver={(e) => {
              const t = e.dataTransfer.types;
              if (!t.includes(TILE_MIME) && !t.includes(FOLDER_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropKey('grid');
            }}
            onDragLeave={() => setDropKey((k) => (k === 'grid' ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              setDropKey(null);
              const fid = e.dataTransfer.getData(FOLDER_MIME);
              if (fid) {
                dropFolder(fid, '');
                return;
              }
              const id = e.dataTransfer.getData(TILE_MIME);
              if (id) dropTile(id, 'loose');
            }}
          >
            {looseTiles.map((b) => (
              <Tile key={b.id} b={b} container="loose" />
            ))}
            {folders.map((f) => (
              <FolderTile key={f.col.id} col={f.col} items={f.items} />
            ))}
            <div className="flex w-[92px] flex-col items-center gap-1.5">
              <button
                className={`grid h-16 w-16 place-items-center rounded-2xl border border-dashed transition hover:-translate-y-0.5 hover:border-brand/60 hover:text-brand ${
                  onWall ? 'border-white/40 text-white/80' : 'border-line text-ink-faint'
                }`}
                onClick={() => setCatalogOpen(true)}
                title="Add apps or a custom link"
              >
                <Icon name="plus" size={24} />
              </button>
              <span className={`text-[11px] leading-tight ${labelCls}`}>Add</span>
            </div>
          </div>
        )}
      </main>

      {/* Folder popup — Atlas-style: the collection expands into a dialog. */}
      {openFolderData?.col && (
        <div
          className="fixed inset-0 z-[2147483644] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setOpenFolder(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface-raised p-6 shadow-float"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: openFolderData.col.color || 'rgb(var(--accent))' }}
              />
              {renaming === openFolderData.col.id ? (
                <input
                  className="input flex-1 px-2 py-1 text-base font-semibold"
                  defaultValue={openFolderData.col.name}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameCollection(openFolderData.col!.id, (e.target as HTMLInputElement).value);
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => renameCollection(openFolderData.col!.id, e.target.value)}
                />
              ) : (
                <h3 className="truncate text-lg font-semibold text-ink">{openFolderData.col.name}</h3>
              )}
              <span className="rounded-full bg-surface-sunken px-2 text-xs text-ink-faint">
                {openFolderData.items.length}
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  className="btn-ghost px-2"
                  onClick={() => setAddTo({ collection: openFolderData.col!.id })}
                  title="Add a link to this folder"
                >
                  <Icon name="plus" size={16} />
                </button>
                <button
                  className="btn-ghost px-2"
                  onClick={() => setRenaming(openFolderData.col!.id)}
                  title="Rename folder"
                >
                  <Icon name="edit" size={15} />
                </button>
                <a
                  className="btn-ghost px-2"
                  href={browser.runtime.getURL('/dashboard.html') + `#c=${openFolderData.col.id}`}
                  title="Open in dashboard"
                >
                  <Icon name="external" size={15} />
                </a>
                <button
                  className="btn-ghost px-2 hover:text-red-500"
                  onClick={() => deleteFolderFromHome(openFolderData.col!, openFolderData.items)}
                  title="Delete folder (removes its tiles from Home)"
                >
                  <Icon name="trash" size={15} />
                </button>
                <button className="btn-ghost px-2" onClick={() => setOpenFolder(null)} title="Close">
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-start justify-center gap-x-2 gap-y-5 overflow-y-auto">
              {openFolderData.items.map((b) => (
                <Tile key={b.id} b={b} container={openFolderData.col!.id} />
              ))}
              {openFolderData.items.length === 0 && (
                <p className="py-8 text-center text-sm text-ink-faint">
                  This folder is empty — it will disappear from Home until you add something.
                </p>
              )}
            </div>

            {draggingTile && (
              <div
                className={`mt-4 grid shrink-0 place-items-center rounded-xl border border-dashed py-3 text-xs transition ${
                  dropKey === 'folder-out' ? 'border-brand text-brand ring-2 ring-brand' : 'border-line text-ink-faint'
                }`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(TILE_MIME)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropKey('folder-out');
                }}
                onDragLeave={() => setDropKey((k) => (k === 'folder-out' ? null : k))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropKey(null);
                  const id = e.dataTransfer.getData(TILE_MIME);
                  if (id) dropTile(id, 'loose');
                }}
              >
                Drop here to move out of this folder
              </div>
            )}
          </div>
        </div>
      )}

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
            setAddTo({});
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
          <li><b>2. Add apps:</b> hit <b>“Add apps”</b> for one-click popular apps — or add a whole category as a folder with <b>“+ Add collection”</b>.</li>
          <li><b>3. Folders:</b> collections show as compact folder tiles. Click one to open it; use its popup to rename, add, or delete.</li>
          <li><b>4. Rearrange:</b> drag tiles to reorder. Drop a tile onto a folder to file it; inside a folder, drag to the bottom bar to move it out. Drag folders to reorder them.</li>
          <li><b>5. Edit a tile:</b> hover → pencil: change title, icon (paste a URL or upload an image), or folder.</li>
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
