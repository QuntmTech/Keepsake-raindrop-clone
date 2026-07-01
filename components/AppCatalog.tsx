import { useMemo, useState } from 'react';
import { APP_CATALOG, appIcon, normUrl, type CatalogApp } from '@/lib/apps';
import { saveBookmark, safeDomain } from '@/lib/bookmarks';
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

// Atlas-style "Add to Home" panel: search a curated catalog of popular apps
// (real brand icons), one-click Add, or create a fully custom app.
export function AppCatalog({ pinnedUrls, onClose, onCustom, onChanged }: Props) {
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  useEscape(onClose);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return APP_CATALOG;
    return APP_CATALOG.filter(
      (a) =>
        a.name.toLowerCase().includes(query) ||
        a.desc.toLowerCase().includes(query) ||
        a.url.toLowerCase().includes(query),
    );
  }, [q]);

  const isAdded = (a: CatalogApp) => pinnedUrls.has(normUrl(a.url)) || justAdded.has(a.url);

  async function add(a: CatalogApp) {
    setBusyUrl(a.url);
    try {
      await saveBookmark({
        url: a.url,
        title: a.name,
        favicon: appIcon(a.url),
        domain: safeDomain(a.url),
        type: 'link',
        pinned: true,
        favorite: true, // lands in the Favorites shelf for one-click access
      });
      setJustAdded((s) => new Set(s).add(a.url));
      onChanged();
      toast(`${a.name} added to Home`, 'success');
    } catch {
      toast('Could not add — check your connection', 'error');
    } finally {
      setBusyUrl(null);
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
          {list.map((a) => {
            const added = isAdded(a);
            return (
              <div key={a.url} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-sunken">
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-surface-raised">
                  <Favicon src={appIcon(a.url)} size={26} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                  <p className="truncate text-xs text-ink-faint">{a.desc}</p>
                </div>
                {added ? (
                  <span className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-faint">Added</span>
                ) : (
                  <button
                    className="btn-primary shrink-0 px-3 py-1 text-xs"
                    onClick={() => add(a)}
                    disabled={busyUrl === a.url}
                  >
                    {busyUrl === a.url ? '…' : 'Add'}
                  </button>
                )}
              </div>
            );
          })}
          {list.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-ink-faint">
              No matches — try “New custom app” to add any site.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
