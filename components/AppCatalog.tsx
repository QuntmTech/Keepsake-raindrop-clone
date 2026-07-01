import { useMemo, useState } from 'react';
import { APP_CATEGORIES, categoryColor, normUrl, type CatalogApp, type CatalogCategory } from '@/lib/apps';
import { saveBookmark, updateBookmark, listCollections, createCollection, safeDomain } from '@/lib/bookmarks';
import { findSaveByUrl } from '@/lib/save';
import { type Bookmark } from '@/lib/types';
import { useEscape } from '@/hooks/useEscape';
import { Icon } from './Icon';
import { Favicon } from './Favicon';
import { useToast } from './Toast';

interface Props {
  pinnedUrls: Set<string>; // normalized URLs already pinned to Home
  onClose: () => void;
  onCustom: () => void; // open the "new custom app" dialog
  onChanged: () => void; // something was added — refresh Home
}

// "Add to Home" panel: a curated catalog of popular apps grouped by category.
// One-click Add pins a single app; "Add collection" drops a whole category
// onto Home as a ready-made, pre-ordered collection. Catalog tiles are
// homeOnly: they live on Home and never clutter the bookmark library.
export function AppCatalog({ pinnedUrls, onClose, onCustom, onChanged }: Props) {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [busyCat, setBusyCat] = useState<string | null>(null);
  useEscape(onClose);

  const categories = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return APP_CATEGORIES;
    return APP_CATEGORIES.map((c) => ({
      ...c,
      apps: c.apps.filter(
        (a) =>
          a.name.toLowerCase().includes(query) ||
          a.url.toLowerCase().includes(query) ||
          c.name.toLowerCase().includes(query),
      ),
    })).filter((c) => c.apps.length > 0);
  }, [q]);

  const isAdded = (a: CatalogApp) => pinnedUrls.has(normUrl(a.url)) || justAdded.has(a.url);

  // Pin one catalog app to Home. If the URL is already saved (matched by
  // canonical URL, so trailing slashes/www don't fork duplicates) we pin the
  // existing record instead of duplicating it — WITHOUT reorganizing it: a
  // library bookmark keeps its collection and favorite flag; only tiles that
  // have no collection yet adopt the cluster collection. Resolves only when
  // the pin durably stuck (server or overlay), so the success toast is truthful.
  async function pinApp(a: CatalogApp, extra: Partial<Bookmark> = {}): Promise<void> {
    const dup = await findSaveByUrl(a.url, { homeOnly: 'include' });
    const existing = dup ? { id: dup.id, collection: dup.organization.collectionId } : null;
    const bm = existing
      ? await updateBookmark(existing.id, {
          pinned: true,
          ...(extra.sort !== undefined ? { sort: extra.sort } : {}),
          ...(extra.collection && !existing.collection ? { collection: extra.collection } : {}),
        })
      : await saveBookmark({
          url: a.url,
          title: a.name,
          favicon: a.icon,
          domain: safeDomain(a.url),
          type: 'link',
          pinned: true,
          homeOnly: true,
          ...extra,
        });
    if (!bm.pinned) throw new Error('Pin did not persist');
    setJustAdded((s) => new Set(s).add(a.url));
  }

  async function add(a: CatalogApp) {
    setBusyUrl(a.url);
    try {
      await pinApp(a);
      onChanged();
      toast(`${a.name} added to Home`, 'success');
    } catch {
      toast('Could not add — check your connection', 'error');
    } finally {
      setBusyUrl(null);
    }
  }

  // One-click cluster collection: create (or reuse) a collection named after
  // the category and pin every app in it, in catalog order. Apps already on
  // Home are skipped — never duplicated.
  async function addCategory(cat: CatalogCategory) {
    setBusyCat(cat.name);
    try {
      const cols = await listCollections();
      const col =
        cols.find((c) => c.name.trim().toLowerCase() === cat.name.toLowerCase()) ??
        (await createCollection({ name: cat.name, color: categoryColor(cat.name) }));
      let added = 0;
      let skipped = 0;
      for (let i = 0; i < cat.apps.length; i++) {
        const a = cat.apps[i];
        if (isAdded(a)) {
          skipped++;
          continue;
        }
        await pinApp(a, { collection: col.id, sort: i });
        added++;
      }
      onChanged();
      toast(
        added
          ? `Added the ${cat.name} collection (${added} app${added === 1 ? '' : 's'}${skipped ? `, ${skipped} already on Home` : ''})`
          : `Everything in ${cat.name} is already on Home`,
        added ? 'success' : 'info',
      );
    } catch {
      toast(`Could not add the ${cat.name} collection — check your connection`, 'error');
    } finally {
      setBusyCat(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[2147483645] flex justify-end bg-black/30 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-sm flex-col border-l border-line bg-surface animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Add to Home</h3>
          <button className="btn-ghost px-2" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 focus-within:border-brand/50">
            <Icon name="search" size={15} className="text-ink-faint" />
            <input
              className="flex-1 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
              placeholder="Search apps…"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn-outline w-full" onClick={onCustom}>
            <Icon name="plus" size={15} /> New custom app
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {categories.map((cat) => (
            <section key={cat.name} className="mb-3">
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: categoryColor(cat.name) }} />
                <h4 className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  {cat.name}
                </h4>
                <button
                  className="btn-outline shrink-0 px-2 py-0.5 text-[11px]"
                  onClick={() => addCategory(cat)}
                  disabled={busyCat !== null}
                  title={`Add all ${cat.apps.length} as a ready-made "${cat.name}" collection on Home`}
                >
                  {busyCat === cat.name ? 'Adding…' : '+ Add collection'}
                </button>
              </div>
              {cat.apps.map((a) => {
                const added = isAdded(a);
                return (
                  <div key={`${cat.name}:${a.url}`} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-sunken">
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-surface-raised">
                      <Favicon src={a.icon} size={26} label={a.name} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                      <p className="truncate text-xs text-ink-faint">{safeDomain(a.url) || a.url}</p>
                    </div>
                    {added ? (
                      <span className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-faint">Added</span>
                    ) : (
                      <button
                        className="btn-primary shrink-0 px-3 py-1 text-xs"
                        onClick={() => add(a)}
                        disabled={busyUrl === a.url || busyCat !== null}
                      >
                        {busyUrl === a.url ? '…' : 'Add'}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
          {categories.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-ink-faint">
              No matches — try “New custom app” to add any site.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
