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
import { WatchingStrip } from '@/components/WatchingStrip';
import { EditDialog } from '@/components/EditDialog';
import { Favicon } from '@/components/Favicon';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { searchBookmarks, updateBookmark, updateCollection, deleteBookmark, getAllTags, markVisited, watchVault } from '@/lib/bookmarks';
import { syncHomeOverlay, watchHomeOverlay } from '@/lib/home';
import { detectAndParse, importWithAi } from '@/lib/importer';
import { WALLPAPERS, COLOR_SWATCHES, wallpaperCss, colorLuminance, wallpaperUpload, imageFileToDataUrl } from '@/lib/wallpaper';
import { SEARCH_ENGINES, searchUrl } from '@/lib/search';
import { normUrl } from '@/lib/apps';
import { onboardingStage } from '@/lib/onboarding';
import { Tour, type TourStep } from '@/components/Tour';
import { type Bookmark, type Collection } from '@/lib/types';

const TILE_MIME = 'application/x-keepsake-tile';
const FOLDER_MIME = 'application/x-keepsake-folder';
const seenHelp = storage.defineItem<boolean>('local:seen_home_help', { fallback: false });
// Free-form grid order: 'b:<bookmarkId>' / 'c:<collectionId>' entries. Apps
// and folders interleave in ONE sequence, and the order is persisted on this
// device so a drag always sticks (server sort fields are written too, as the
// best-effort cross-device copy).
const layoutStore = storage.defineItem<string[]>('local:home_layout', { fallback: [] });

// First-run guided tour of Home (runs right after the account is created).
const HOME_TOUR: TourStep[] = [
  {
    title: 'Welcome to Keepsake! 🎉',
    body: 'This is your new Home — a fast launcher for the sites you actually use, backed by a full bookmark library. Here’s a 30-second look around.',
  },
  {
    target: '[data-tour="add-apps"]',
    title: 'Add your apps',
    body: 'One click adds popular apps to your Home — or add any custom link. You can also add a whole category (Social, Dev, News…) as a folder.',
  },
  {
    target: '[data-tour="grid"]',
    title: 'Your launcher grid',
    body: 'Apps live here as tiles; collections show as folders that open with a click. Drag tiles to rearrange, drop one onto a folder to file it, and drag folders around too.',
  },
  {
    target: '[data-tour="search"]',
    title: 'Search everything',
    body: 'Type to instantly search everything you’ve saved. Nothing saved matches? Press Enter and the same box searches the web.',
  },
  {
    target: '[data-tour="capture"]',
    title: 'Capture anything',
    body: 'Screenshots (visible area or full page) and screen recordings — download them or copy straight to your clipboard.',
  },
  {
    target: '[data-tour="wallpaper"]',
    title: 'Make it yours',
    body: 'Pick a gradient, a solid color, or upload your own background image.',
  },
  {
    title: 'One last thing 📌',
    body: 'Pin Keepsake to your toolbar (puzzle icon → pin) and click it on any page to save it. The dropdown holds your full library — we’ll show you around it the first time you open it.',
  },
];

type GridEntry =
  | { key: string; kind: 'tile'; b: Bookmark }
  | { key: string; kind: 'folder'; col: Collection; items: Bookmark[] };

// Which side of a tile the cursor is on — drives the "drop to the left / right"
// insertion line and where the item actually lands.
function pointerSide(e: React.DragEvent, el: HTMLElement): 'before' | 'after' {
  const r = el.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
}

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
  // Insertion indicator: which entry the cursor is near and on which side, so a
  // thin line shows exactly where the dragged item will land (left or right).
  const [dropPos, setDropPos] = useState<{ key: string; side: 'before' | 'after' } | null>(null);
  const [draggingTile, setDraggingTile] = useState<string | null>(null);
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null);
  const clearDrag = () => {
    setDraggingTile(null);
    setDraggingFolder(null);
    setDropKey(null);
    setDropPos(null);
  };
  const [addTo, setAddTo] = useState<{ collection?: string } | null>(null);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [tour, setTour] = useState(false);
  const [freshInstall, setFreshInstall] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [uploadedWall, setUploadedWall] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const wallFileRef = useRef<HTMLInputElement>(null);
  const uidRef = useRef<string | null>(null);

  // Load + track the uploaded background image (stored locally, not synced).
  useEffect(() => {
    wallpaperUpload.getValue().then(setUploadedWall);
    return wallpaperUpload.watch((v) => setUploadedWall(v ?? ''));
  }, []);

  async function onWallpaperFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await imageFileToDataUrl(file);
        await wallpaperUpload.setValue(dataUrl);
        await update({ wallpaper: 'upload' });
        toast('Background updated', 'success');
      } catch {
        toast('Could not read that image', 'error');
      }
    }
    if (wallFileRef.current) wallFileRef.current.value = '';
    setWallOpen(false);
  }

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

  // Fresh install → the sign-up form comes pre-selected on the login screen.
  useEffect(() => {
    onboardingStage.getValue().then((s) => setFreshInstall(s === 'fresh'));
  }, [authed]);

  // First run after sign-up → guided tour. Otherwise show the setup guide once.
  useEffect(() => {
    if (!authed) return;
    (async () => {
      const stage = await onboardingStage.getValue();
      if (stage === 'fresh') {
        // The tour replaces the one-time help dialog (still reachable via "?").
        await seenHelp.setValue(true);
        setTour(true);
        return;
      }
      const seen = await seenHelp.getValue();
      if (!seen) {
        setHelp(true);
        seenHelp.setValue(true);
      }
    })();
  }, [authed]);

  const finishTour = useCallback(() => {
    setTour(false);
    setFreshInstall(false);
    // Next stop: the extension dropdown shows its own mini-tour on first open.
    onboardingStage.setValue('home-done').catch(() => {});
  }, []);
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

  // Escape closes any open Home popover (folder popup, wallpaper picker).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenFolder(null);
        setWallOpen(false);
      }
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

  // The one flowing grid: loose apps and folders interleaved, ordered by the
  // persisted layout; anything not in the layout yet keeps its default spot.
  const [layout, setLayout] = useState<string[]>([]);
  useEffect(() => {
    layoutStore.getValue().then(setLayout);
  }, []);
  const gridEntries = useMemo<GridEntry[]>(() => {
    const pool = new Map<string, GridEntry>();
    looseTiles.forEach((b) => pool.set(`b:${b.id}`, { key: `b:${b.id}`, kind: 'tile', b }));
    folders.forEach((f) => pool.set(`c:${f.col.id}`, { key: `c:${f.col.id}`, kind: 'folder', col: f.col, items: f.items }));
    const out: GridEntry[] = [];
    for (const k of layout) {
      const e = pool.get(k);
      if (e) {
        out.push(e);
        pool.delete(k);
      }
    }
    for (const e of pool.values()) out.push(e);
    return out;
  }, [looseTiles, folders, layout]);

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
  async function dropTile(bmId: string, target: string, anchorId?: string, side: 'before' | 'after' = 'before') {
    const container = target === 'loose' ? looseTiles : folderItems(target);
    const bySort = new Map(container.map((b) => [b.id, b.sort]));
    const list = container.map((b) => b.id).filter((id) => id !== bmId);
    let at = list.length;
    if (anchorId) {
      const i = list.indexOf(anchorId);
      at = i < 0 ? list.length : side === 'after' ? i + 1 : i;
    }
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
      // Only persist rows whose position actually changed — one drag must not
      // fan out into a PATCH per tile in the container.
      await Promise.all(
        list
          .map((id, i) => {
            if (id === bmId) return updateBookmark(id, { ...membership, sort: i });
            if (bySort.get(id) === i) return null;
            return updateBookmark(id, { sort: i });
          })
          .filter((p): p is Promise<Bookmark> => p !== null),
      );
    } catch {
      toast('Could not save the new order', 'error');
    }
    reloadAll();
  }

  // Free-form reposition: move any grid entry (app tile OR folder) before
  // another entry, or to the end. The layout persists on this device
  // immediately; server sort fields get the combined order as best effort.
  async function dropEntry(dragKey: string, anchorKey?: string, side: 'before' | 'after' = 'before') {
    if (dragKey === anchorKey) return;
    const keys = gridEntries.map((e) => e.key).filter((k) => k !== dragKey);
    let at = keys.length;
    if (anchorKey) {
      const i = keys.indexOf(anchorKey);
      at = i < 0 ? keys.length : side === 'after' ? i + 1 : i;
    }
    keys.splice(at, 0, dragKey);
    setLayout(keys); // instant paint
    layoutStore.setValue(keys).catch(() => {});

    // A tile dragged out of a folder onto the grid becomes loose.
    if (dragKey.startsWith('b:')) {
      const id = dragKey.slice(2);
      const bm = all.find((b) => b.id === id);
      if (bm && bm.collection && colIds.has(bm.collection)) {
        setAll((cur) => cur.map((b) => (b.id === id ? { ...b, collection: undefined, pinned: true } : b)));
        await updateBookmark(id, { collection: undefined, pinned: true }).catch(() =>
          toast('Could not move the tile out of its folder', 'error'),
        );
      }
    }

    // Mirror the combined order into the sort fields (diff-only) so other
    // devices approximate this layout too.
    const tileSort = new Map(pinnedItems.map((b) => [b.id, b.sort]));
    const colSort = new Map(c.collections.map((x) => [x.id, x.sort]));
    try {
      await Promise.all(
        keys.map((k, i) => {
          const id = k.slice(2);
          if (k.startsWith('b:')) {
            return tileSort.get(id) === i ? null : updateBookmark(id, { sort: i }).catch(() => null);
          }
          return colSort.get(id) === i ? null : updateCollection(id, { sort: i }).catch(() => null);
        }),
      );
    } catch {
      /* layout is already safe locally */
    }
    reloadAll();
    c.refresh();
  }

  // Pull an app out of its collection back onto the main grid. Explicit button
  // in the folder popup (dragging out works too, but this is unmissable).
  async function moveOutOfFolder(b: Bookmark) {
    const col = b.collection || '';
    const wasLast = folderItems(col).length <= 1;
    setAll((cur) => cur.map((x) => (x.id === b.id ? { ...x, collection: undefined, pinned: true } : x)));
    const keys = gridEntries.map((e) => e.key).filter((k) => k !== `b:${b.id}`);
    keys.push(`b:${b.id}`); // land at the end of the grid
    setLayout(keys);
    layoutStore.setValue(keys).catch(() => {});
    if (wasLast) setOpenFolder(null);
    try {
      await updateBookmark(b.id, { collection: undefined, pinned: true });
      toast(`Moved ${b.title} out to Home`, 'success');
    } catch {
      toast('Could not move it out — check your connection', 'error');
    }
    reloadAll();
    c.refresh();
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
    const { items } = detectAndParse(file.name, text);
    if (!items.length) {
      toast('No links found in that file', 'error');
      return;
    }
    toast(`Importing ${items.length}…`, 'info');
    const res = await importWithAi(items, undefined);
    toast(`Imported ${res.done - res.failed} links · ${res.duplicates} duplicates skipped${res.queuedForAi ? ` · ${res.queuedForAi} queued for AI filing` : ''}`, 'success');
    reloadAll();
    c.refresh();
    if (fileRef.current) fileRef.current.value = '';
  }

  if (!ready) return <div className="grid h-screen place-items-center text-ink-faint">Loading…</div>;
  if (!authed)
    return (
      <div className="grid min-h-screen place-items-center bg-surface-sunken">
        <div className="card w-full max-w-sm">
          <LoginForm onLogin={login} onSignup={signup} defaultMode={freshInstall ? 'signup' : 'login'} />
        </div>
      </div>
    );

  const minimal = settings.newTabMode === 'minimal';
  const wall = wallpaperCss(settings.wallpaper, uploadedWall);
  const onWall = Boolean(wall);
  // A solid LIGHT color needs dark text; images and dark gradients need light
  // text (and a subtle dark overlay for contrast).
  const isColor = settings.wallpaper.startsWith('color:');
  const lightColor = isColor && colorLuminance(settings.wallpaper.slice(6)) > 0.6;
  const onDark = onWall && !lightColor; // use light text
  // Panels: solid cards normally, frosted glass over a wallpaper.
  const panelCls = onWall
    ? 'border-white/15 bg-surface-raised/90 backdrop-blur-md'
    : 'border-line bg-surface-raised shadow-card';
  const iconCls = onWall
    ? 'border-white/20 bg-surface-raised/95 backdrop-blur-md'
    : 'border-line bg-surface-raised shadow-card';
  const labelCls = onDark ? 'text-white/90 drop-shadow' : 'text-ink-soft';

  // A single app tile: icon square + label, Atlas-sized. `statik` disables
  // drag & drop (used in search results, where reordering has no meaning).
  // Render FUNCTIONS, not nested components: a component type defined inside
  // App would get a new identity every render, forcing React to unmount and
  // remount every tile (killing drag state and flashing icons on each
  // clock tick / keystroke).
  const renderTile = (b: Bookmark, container: string, statik?: boolean) => {
    const key = container === 'loose' ? `b:${b.id}` : `tile:${container}:${b.id}`;
    const inFolder = container !== 'loose' && container !== 'results';
    const showLine = dropPos?.key === key;
    return (
      <div
        key={b.id}
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
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          const t = e.dataTransfer.types;
          // A tile accepts other tiles anywhere; on the main grid it also
          // accepts folders (so a folder can sit between single apps).
          if (statik || (!t.includes(TILE_MIME) && !(container === 'loose' && t.includes(FOLDER_MIME)))) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          setDropKey(null);
          setDropPos({ key, side: pointerSide(e, e.currentTarget) });
        }}
        onDragLeave={() => setDropPos((p) => (p?.key === key ? null : p))}
        onDrop={(e) => {
          if (statik) return;
          e.preventDefault();
          e.stopPropagation();
          const side = pointerSide(e, e.currentTarget);
          clearDrag();
          const fid = e.dataTransfer.getData(FOLDER_MIME);
          if (fid && container === 'loose') {
            dropEntry(`c:${fid}`, `b:${b.id}`, side);
            return;
          }
          const id = e.dataTransfer.getData(TILE_MIME);
          if (!id || id === b.id) return;
          // Grid drops reposition in the free-form layout; folder-popup drops
          // reorder within that folder.
          if (container === 'loose') dropEntry(`b:${id}`, `b:${b.id}`, side);
          else dropTile(id, container, b.id, side);
        }}
        title={b.title}
      >
        {showLine && (
          <span
            className={`pointer-events-none absolute inset-y-2 z-20 w-[3px] rounded-full bg-brand ${
              dropPos!.side === 'before' ? '-left-[7px]' : '-right-[7px]'
            }`}
          />
        )}
        <div
          className={`grid h-16 w-16 place-items-center overflow-hidden rounded-2xl border transition group-hover:-translate-y-0.5 group-hover:shadow-float ${
            inFolder ? 'border-line bg-surface-raised shadow-card' : iconCls
          }`}
        >
          <Favicon src={b.favicon} size={34} label={b.title} />
        </div>
        <div className="absolute -right-1 -top-1 z-10 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
          {inFolder && (
            <button
              className="grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-ink-faint shadow-card hover:text-brand"
              onClick={(e) => {
                e.stopPropagation();
                moveOutOfFolder(b);
              }}
              title="Move out to Home"
            >
              <Icon name="external" size={10} />
            </button>
          )}
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
        <span
          className={`line-clamp-1 max-w-[92px] text-center text-[11px] leading-tight ${
            inFolder ? 'text-ink-soft' : labelCls
          }`}
        >
          {b.title}
        </span>
      </div>
    );
  };

  // A folder tile: mini 2×2 icon preview. Click opens the folder popup;
  // drop a tile on it to file the tile into the collection.
  const renderFolder = (col: Collection, items: Bookmark[]) => {
    const key = `c:${col.id}`;
    const dk = `folder:${col.id}`;
    const showLine = dropPos?.key === key;
    return (
      <div
        key={col.id}
        className={`group relative flex w-[92px] cursor-pointer flex-col items-center gap-1.5 ${
          draggingFolder === col.id ? 'opacity-40' : ''
        }`}
        draggable
        onClick={() => setOpenFolder(col.id)}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(FOLDER_MIME, col.id);
          e.dataTransfer.effectAllowed = 'move';
          setDraggingFolder(col.id);
        }}
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          const t = e.dataTransfer.types;
          if (!t.includes(TILE_MIME) && !t.includes(FOLDER_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          if (t.includes(FOLDER_MIME)) {
            // Reordering one folder past another — show the insertion line.
            setDropKey(null);
            setDropPos({ key, side: pointerSide(e, e.currentTarget) });
          } else {
            // An app being dropped INTO this folder — highlight the whole tile.
            setDropPos(null);
            setDropKey(dk);
          }
        }}
        onDragLeave={() => {
          setDropKey((k) => (k === dk ? null : k));
          setDropPos((p) => (p?.key === key ? null : p));
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const side = pointerSide(e, e.currentTarget);
          clearDrag();
          const fid = e.dataTransfer.getData(FOLDER_MIME);
          if (fid) {
            if (fid !== col.id) dropEntry(`c:${fid}`, `c:${col.id}`, side);
            return;
          }
          const id = e.dataTransfer.getData(TILE_MIME);
          if (id) dropTile(id, col.id); // file the app into this folder
        }}
        title={`${col.name} — ${items.length} app${items.length === 1 ? '' : 's'} · drag to move, drop apps here to file them`}
      >
        {showLine && (
          <span
            className={`pointer-events-none absolute inset-y-2 z-20 w-[3px] rounded-full bg-brand ${
              dropPos!.side === 'before' ? '-left-[7px]' : '-right-[7px]'
            }`}
          />
        )}
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

  const headBtn = `btn-ghost px-2 ${onDark ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`;

  return (
    <div
      className={`relative min-h-screen text-ink ${onWall ? '' : 'bg-surface-sunken'}`}
      style={onWall ? { background: wall, backgroundAttachment: 'fixed' } : undefined}
    >
      {onDark && !isColor && <div className="pointer-events-none fixed inset-0 bg-black/35" />}
      <div className="relative">
      <header className="flex items-center gap-2 px-6 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
          <Icon name="bookmark" size={17} fill />
        </span>
        <span className={`text-base font-semibold ${onDark ? 'text-white drop-shadow' : ''}`}>Keepsake</span>
        <div className="ml-auto flex items-center gap-1.5">
          <input ref={fileRef} type="file" accept=".html,.json,.csv" className="hidden" onChange={onFile} />
          <button data-tour="add-apps" className="btn-primary px-3 py-1.5 text-sm" onClick={() => setCatalogOpen(true)} title="Add apps to your Home">
            <Icon name="plus" size={15} /> Add apps
          </button>
          <div data-tour="capture">
            <CaptureMenu buttonClass={`btn-ghost px-2.5 text-sm ${onDark ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`} />
          </div>
          <button className={`btn-ghost px-2.5 text-sm ${onDark ? 'text-white/80 hover:text-white hover:bg-white/10' : ''}`} onClick={() => fileRef.current?.click()} title="Import links">
            <Icon name="import" size={17} /> Import
          </button>
          <div className="relative">
            <button data-tour="wallpaper" className={headBtn} onClick={() => setWallOpen((o) => !o)} title="Wallpaper">
              <Icon name="image" size={18} />
            </button>
            {wallOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setWallOpen(false)} />
                <div className="absolute right-0 top-10 z-20 max-h-[80vh] w-64 overflow-y-auto rounded-xl border border-line bg-surface-raised p-3 shadow-float">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Gradients</p>
                  <div className="grid grid-cols-4 gap-2">
                    {WALLPAPERS.map((w) => (
                      <button
                        key={w.key}
                        className={`h-10 rounded-lg border transition hover:scale-105 ${
                          settings.wallpaper === w.key ? 'border-brand ring-2 ring-brand' : 'border-line'
                        }`}
                        style={{ background: w.css || 'rgb(var(--surface-sunken))' }}
                        onClick={() => update({ wallpaper: w.key })}
                        title={w.label}
                      >
                        {w.key === '' && <span className="text-[9px] text-ink-faint">None</span>}
                      </button>
                    ))}
                  </div>

                  <p className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">Solid color</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {COLOR_SWATCHES.map((hex) => (
                      <button
                        key={hex}
                        className={`h-7 w-7 rounded-lg border transition hover:scale-110 ${
                          settings.wallpaper === `color:${hex}` ? 'border-brand ring-2 ring-brand' : 'border-line'
                        }`}
                        style={{ background: hex }}
                        onClick={() => update({ wallpaper: `color:${hex}` })}
                        title={hex}
                      />
                    ))}
                    <label
                      className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border border-line text-ink-faint hover:text-brand"
                      title="Pick any color"
                    >
                      <Icon name="plus" size={13} />
                      <input
                        type="color"
                        className="sr-only"
                        value={isColor ? settings.wallpaper.slice(6) : '#1e293b'}
                        onChange={(e) => update({ wallpaper: `color:${e.target.value}` })}
                      />
                    </label>
                  </div>

                  <p className="mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">Your image</p>
                  <input ref={wallFileRef} type="file" accept="image/*" className="hidden" onChange={onWallpaperFile} />
                  <div className="flex items-center gap-2">
                    <button className="btn-outline flex-1 text-xs" onClick={() => wallFileRef.current?.click()}>
                      <Icon name="image" size={14} /> Upload image
                    </button>
                    {settings.wallpaper === 'upload' && uploadedWall && (
                      <span
                        className="h-8 w-8 shrink-0 rounded-lg border border-brand ring-2 ring-brand"
                        style={{ background: `center / cover no-repeat url("${uploadedWall}")` }}
                        title="Current upload"
                      />
                    )}
                  </div>
                  <input
                    className="input mt-2 text-xs"
                    placeholder="…or paste an image URL"
                    defaultValue={settings.wallpaper.startsWith('url:') ? settings.wallpaper.slice(4) : ''}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value.trim();
                        update({ wallpaper: v ? `url:${v}` : '' });
                        setWallOpen(false);
                      }
                    }}
                  />

                  <button
                    className="mt-3 w-full rounded-lg border border-line py-1.5 text-xs text-ink-soft hover:border-brand/50 hover:text-brand"
                    onClick={() => {
                      update({ wallpaper: '' });
                      setWallOpen(false);
                    }}
                  >
                    Reset to default
                  </button>
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
          <p className={`text-5xl font-semibold tracking-tight ${onDark ? 'text-white drop-shadow-lg' : ''}`}>{time}</p>
          <p className={`mt-2 text-lg ${onDark ? 'text-white/90 drop-shadow' : 'text-ink-soft'}`}>
            {greeting}
            {name ? `, ${name}` : ''}.
          </p>
        </div>

        <div data-tour="search" className={`mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border px-4 py-3 focus-within:border-brand/50 ${panelCls}`}>
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
            <h2 className={`mb-4 text-center text-xs font-semibold uppercase tracking-wide ${onDark ? 'text-white/80' : 'text-ink-faint'}`}>
              Results for “{query}”
            </h2>
            <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-5">
              {results.map((b) => renderTile(b, 'results', true))}
              {results.length === 0 && (
                <p className={`py-6 text-center text-sm ${onDark ? 'text-white/80' : 'text-ink-faint'}`}>
                  Nothing saved — press Enter to search the web.
                </p>
              )}
            </div>
          </div>
        ) : pinnedItems.length === 0 ? (
          /* Curated-Home bootstrap: nothing pinned yet */
          <div data-tour="grid" className={`mx-auto mt-10 max-w-lg rounded-2xl border p-8 text-center ${panelCls}`}>
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
            data-tour="grid"
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
              clearDrag();
              const fid = e.dataTransfer.getData(FOLDER_MIME);
              if (fid) {
                dropEntry(`c:${fid}`); // to the end
                return;
              }
              const id = e.dataTransfer.getData(TILE_MIME);
              if (id) dropEntry(`b:${id}`); // to the end (also pulls it out of a folder)
            }}
          >
            {gridEntries.map((e) => (e.kind === 'tile' ? renderTile(e.b, 'loose') : renderFolder(e.col, e.items)))}
            <div className="flex w-[92px] flex-col items-center gap-1.5">
              <button
                className={`grid h-16 w-16 place-items-center rounded-2xl border border-dashed transition hover:-translate-y-0.5 hover:border-brand/60 hover:text-brand ${
                  onDark ? 'border-white/40 text-white/80' : 'border-line text-ink-faint'
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

        {results === null && !minimal && <WatchingStrip panelCls={panelCls} labelCls={labelCls} />}
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
              {openFolderData.items.map((b) => renderTile(b, openFolderData.col!.id))}
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
                  clearDrag();
                  const id = e.dataTransfer.getData(TILE_MIME);
                  if (id) dropEntry(`b:${id}`); // becomes a loose tile at the end of the grid
                }}
              >
                ⤴ Drop here to move out of this folder — or use the ↗ button on any app
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
          pinned
          homeContext
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
      {tour && <Tour steps={HOME_TOUR} onDone={finishTour} />}
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
