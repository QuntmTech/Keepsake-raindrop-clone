import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { storage } from 'wxt/utils/storage';
import { useAuth } from '@/hooks/useAuth';
import { currentUser } from '@/lib/auth';
import { readSnapshot, writeSnapshot } from '@/lib/cache';
import { useSettings } from '@/hooks/useSettings';
import { useCollections } from '@/hooks/useCollections';
import { LoginForm } from '@/components/LoginForm';
import { AddDialog } from '@/components/AddDialog';
import { EditDialog } from '@/components/EditDialog';
import { Favicon } from '@/components/Favicon';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { searchBookmarks, updateBookmark, deleteBookmark, getAllTags, markVisited, watchVault } from '@/lib/bookmarks';
import { parseNetscapeHtml, parseKeepsakeJson, importItems } from '@/lib/importer';
import { WALLPAPERS, wallpaperCss } from '@/lib/wallpaper';
import { SEARCH_ENGINES, searchUrl } from '@/lib/search';
import { type Bookmark, type Collection } from '@/lib/types';

const TILE_MIME = 'application/x-keepsake-tile';
const seenHelp = storage.defineItem<boolean>('local:seen_home_help', { fallback: false });

interface Section {
  key: string; // 'fav' or collection id
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
  const [addTo, setAddTo] = useState<{ favorite?: boolean; collection?: string } | null>(null);
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [help, setHelp] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const uidRef = useRef<string | null>(null);

  const reloadAll = useCallback(() => {
    // Keep current links on screen if the request is slow/fails — never blank out.
    searchBookmarks('', { perPage: 500 }).then(setAll).catch(() => {});
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
    return watchVault(() => {
      reloadAll();
      c.refresh();
    });
  }, [authed, reloadAll, c]);

  useEffect(() => {
    if (!authed) return;
    const id = setTimeout(() => {
      const q = query.trim();
      if (!q) return setResults(null);
      searchBookmarks(q, { perPage: 40 }).then(setResults).catch(() => setResults([]));
    }, 150);
    return () => clearTimeout(id);
  }, [query, authed]);

  const byOrder = (a: Bookmark, b: Bookmark) =>
    (a.sort ?? 1e9) - (b.sort ?? 1e9) || b.created.localeCompare(a.created);

  const sections: Section[] = useMemo(() => {
    const favs: Section = { key: 'fav', title: 'Favorites', items: all.filter((b) => b.favorite).sort(byOrder) };
    const cols: Section[] = c.collections.map((col: Collection) => ({
      key: col.id,
      title: col.name,
      color: col.color,
      items: all.filter((b) => b.collection === col.id).sort(byOrder),
    }));
    return [favs, ...cols];
  }, [all, c.collections]);

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
  async function dropTile(bmId: string, sectionKey: string, beforeId?: string) {
    const section = sections.find((s) => s.key === sectionKey);
    if (!section) return;
    const ids = section.items.map((b) => b.id).filter((id) => id !== bmId);
    let at = beforeId ? ids.indexOf(beforeId) : ids.length;
    if (at < 0) at = ids.length;
    ids.splice(at, 0, bmId);
    const membership = sectionKey === 'fav' ? { favorite: true } : { collection: sectionKey };
    try {
      await Promise.all(
        ids.map((id, i) => updateBookmark(id, id === bmId ? { ...membership, sort: i } : { sort: i })),
      );
    } catch {
      /* ignore */
    }
    reloadAll();
  }

  async function removeFromHome(b: Bookmark, sectionKey: string) {
    // From Favorites -> just unfavorite; from a collection -> unfile it.
    await updateBookmark(b.id, sectionKey === 'fav' ? { favorite: false } : { collection: undefined });
    reloadAll();
  }
  async function del(b: Bookmark) {
    if (!confirm(`Delete “${b.title}”?`)) return;
    await deleteBookmark(b.id);
    reloadAll();
    toast('Deleted', 'info');
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
  const coverFor = (s: Section): string | undefined => {
    const withImg = s.items.find((b) => b.cover || b.screenshot);
    return withImg?.cover || withImg?.screenshot || undefined;
  };

  const Tile = ({ b, sectionKey }: { b: Bookmark; sectionKey: string }) => (
    <div
      className={`group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border bg-surface-raised p-3 transition hover:-translate-y-0.5 hover:shadow-card ${
        dropKey === `${sectionKey}:${b.id}` ? 'border-brand ring-2 ring-brand' : 'border-line hover:border-brand/40'
      }`}
      draggable
      onClick={() => open(b)}
      onDragStart={(e) => {
        e.dataTransfer.setData(TILE_MIME, b.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
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
            removeFromHome(b, sectionKey);
          }}
          title="Remove from this section"
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      <Favicon src={b.favicon} size={30} />
      <span className="line-clamp-2 text-center text-xs text-ink-soft">{b.title}</span>
    </div>
  );

  const SectionBlock = ({ s }: { s: Section }) => (
    <div
      className="rounded-2xl"
      onDragOver={(e) => {
        e.preventDefault();
        setDropKey(s.key);
      }}
      onDragLeave={() => setDropKey((k) => (k === s.key ? null : k))}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData(TILE_MIME);
        setDropKey(null);
        if (id) dropTile(id, s.key);
      }}
    >
      {/* Catalog-style cover header */}
      <div
        className="relative mb-3 flex h-16 items-end overflow-hidden rounded-xl"
        style={{ background: `linear-gradient(120deg, ${s.color || 'rgb(var(--accent))'} 0%, rgb(var(--accent-dark)) 100%)` }}
      >
        {coverFor(s) && (
          <img src={coverFor(s)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-50" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
        <div className="relative flex w-full items-center gap-2 px-3 pb-2 text-white">
          <h2 className="text-sm font-semibold drop-shadow">{s.key === 'fav' ? '★ Favorites' : s.title}</h2>
          <span className="rounded-full bg-white/20 px-1.5 text-xs">{s.items.length}</span>
          <button
            className="ml-auto rounded-md bg-white/15 p-1 text-white hover:bg-white/30"
            onClick={() => setAddTo(s.key === 'fav' ? { favorite: true } : { collection: s.key })}
            title="Add a link here"
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
      </div>
      <div
        className={`grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3 rounded-xl p-1 ${
          dropKey === s.key ? 'ring-2 ring-brand ring-inset' : ''
        }`}
      >
        {s.items.map((b) => (
          <Tile key={b.id} b={b} sectionKey={s.key} />
        ))}
        <button
          className="flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line text-ink-faint transition hover:border-brand/50 hover:text-brand"
          onClick={() => setAddTo(s.key === 'fav' ? { favorite: true } : { collection: s.key })}
        >
          <Icon name="plus" size={18} />
          <span className="text-[11px]">Add</span>
        </button>
      </div>
    </div>
  );

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
        <div className="mt-[6vh] text-center">
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
        ) : (
          <div className="mt-10 space-y-8">
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
          <li><b>1. New tab:</b> already replaced with Keepsake Home. ✓</li>
          <li>
            <b>2. Homepage button + startup:</b> Chrome → <i>Settings → On startup</i> → “Open the New Tab page”, and turn on
            the <i>Home button</i> (Appearance) set to New Tab.
          </li>
          <li><b>3. Add tiles:</b> click <b>+</b> in any section (Favorites or a collection).</li>
          <li><b>4. Edit:</b> hover a tile → pencil to change its title, icon, or collection.</li>
          <li><b>5. Rearrange:</b> drag tiles to reorder; drop one onto another collection to <b>group</b> it there.</li>
          <li><b>6. Import:</b> use <b>Import</b> (top bar) to bring in a Chrome/Brave/raindrop bookmarks file.</li>
          <li><b>7. Search:</b> type to find saved links; press <b>Enter</b> to search the web.</li>
        </ol>
        <button className="btn-primary mt-4 w-full" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
