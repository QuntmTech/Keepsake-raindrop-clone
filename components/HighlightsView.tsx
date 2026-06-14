import { useEffect, useState } from 'react';
import { allHighlights, deleteHighlight } from '@/lib/highlights';
import { safeDomain, faviconFor } from '@/lib/util';
import { type Highlight, type HighlightColor } from '@/lib/types';
import { Icon } from './Icon';
import { Favicon } from './Favicon';
import { useToast } from './Toast';

const SWATCH: Record<HighlightColor, string> = {
  yellow: '#fde047',
  green: '#86efac',
  blue: '#93c5fd',
  pink: '#f9a8d4',
  orange: '#fdba74',
};

// Lists every saved highlight, grouped by page. Open the source or delete.
export function HighlightsView({ onCountChange }: { onCountChange?: () => void }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    allHighlights(500)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  async function remove(id: string) {
    await deleteHighlight(id);
    setItems((p) => p.filter((h) => h.id !== id));
    toast('Highlight deleted', 'info');
    onCountChange?.();
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-sunken text-ink-faint">
          <Icon name="highlight" size={26} />
        </span>
        <p className="text-sm font-medium text-ink-soft">No highlights yet</p>
        <p className="max-w-xs text-xs text-ink-faint">
          Select text on any web page and pick a color to highlight it. Highlights re-appear when
          you revisit the page.
        </p>
      </div>
    );
  }

  // Group by page URL, preserving recency order of first appearance.
  const groups = new Map<string, Highlight[]>();
  for (const h of items) {
    const arr = groups.get(h.url) ?? [];
    arr.push(h);
    groups.set(h.url, arr);
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([url, hs]) => {
        const domain = safeDomain(url);
        return (
          <div key={url}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mb-2 flex items-center gap-2 text-sm font-medium text-ink hover:text-brand"
            >
              <Favicon src={faviconFor(domain)} size={16} />
              <span className="truncate">{domain || url}</span>
              <Icon name="external" size={13} className="text-ink-faint" />
            </a>
            <div className="space-y-2">
              {hs.map((h) => (
                <div
                  key={h.id}
                  className="group flex items-start gap-3 rounded-xl border border-line bg-surface-raised p-3"
                >
                  <span className="mt-1 h-full w-1 shrink-0 self-stretch rounded-full" style={{ background: SWATCH[h.color] }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{h.text}</p>
                    {h.note && <p className="mt-1 text-xs italic text-ink-faint">“{h.note}”</p>}
                  </div>
                  <button
                    className="rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
                    onClick={() => remove(h.id)}
                    title="Delete highlight"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
