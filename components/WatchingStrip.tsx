import { useEffect, useState } from 'react';
import { watchedSaves } from '@/lib/watch';
import { type Save } from '@/lib/save';
import { Favicon } from './Favicon';
import { Icon } from './Icon';
import { WatchDialog } from './WatchDialog';

// Home "Watching" section (Living Bookmarks): every watched save as a chip
// with its latest value, plus a compact "What changed" feed of recent alerts.

export function WatchingStrip({ panelCls, labelCls }: { panelCls: string; labelCls: string }) {
  const [watches, setWatches] = useState<Save[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [showFeed, setShowFeed] = useState(false);

  const refresh = () => watchedSaves().then(setWatches).catch(() => {});
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!watches.length) return null;

  // Defensive: rows written by older versions (or a partial migration) can
  // lack the monitoring/history shape — a bare `.history.filter` here throws
  // during render and, with no data lost, blanks the whole Home page.
  const changes = watches
    .flatMap((s) => (s.monitoring?.history ?? []).filter((h) => h.note).map((h) => ({ ...h, save: s })))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 6);

  const modeIcon = (s: Save) =>
    s.monitoring?.mode === 'price' ? '💰' : s.monitoring?.mode === 'availability' ? '📦' : '📝';

  return (
    <section className={`mx-auto mt-10 max-w-4xl rounded-2xl border p-4 ${panelCls}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm">👁</span>
        <h2 className="text-sm font-semibold text-ink">Watching</h2>
        <span className="rounded-full bg-surface-sunken px-1.5 text-[11px] text-ink-faint">{watches.length}</span>
        {changes.length > 0 && (
          <button
            className="ml-auto flex items-center gap-1 text-xs text-ink-faint hover:text-brand"
            onClick={() => setShowFeed((v) => !v)}
          >
            What changed <Icon name="chevron" size={12} className={showFeed ? 'rotate-90' : ''} />
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {watches.map((s) => {
          const stale = s.archive?.status !== 'alive';
          return (
            <button
              key={s.id}
              className={`flex items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-xs transition hover:border-brand/50 ${
                stale ? 'border-red-400/40' : 'border-line'
              } bg-surface`}
              onClick={() => setEditing(s.id)}
              title={`${s.title}\n${s.url}${s.monitoring?.jsRendered ? '\n(checks when you visit)' : ''}`}
            >
              <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-full border border-line bg-surface-raised">
                <Favicon src={s.favicon} size={14} label={s.title} />
              </span>
              <span className="max-w-[140px] truncate font-medium text-ink">{s.title}</span>
              <span className="text-ink-faint">
                {modeIcon(s)}{' '}
                {s.monitoring?.mode === 'price' && s.monitoring?.lastValue
                  ? `$${s.monitoring?.lastValue}`
                  : s.monitoring?.mode === 'availability'
                    ? s.monitoring?.lastValue === 'in-stock'
                      ? 'in stock'
                      : s.monitoring?.lastValue === 'out-of-stock'
                        ? 'out of stock'
                        : '…'
                    : s.monitoring?.lastCheckedAt
                      ? 'tracking'
                      : 'pending'}
              </span>
              {stale &&
                (s.archive?.waybackUrl ? (
                  <a
                    href={s.archive?.waybackUrl}
                    className="text-red-500 underline"
                    onClick={(e) => e.stopPropagation()}
                    title="Original is dead — open the archived copy"
                  >
                    archive
                  </a>
                ) : (
                  <span className="text-red-500">dead</span>
                ))}
            </button>
          );
        })}
      </div>

      {showFeed && changes.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {changes.map((c) => (
            <li key={`${c.save.id}-${c.ts}`} className="flex items-baseline gap-2 text-xs">
              <span className="shrink-0 text-ink-faint">{new Date(c.ts).toLocaleDateString()}</span>
              <a href={c.save.url} className={`hover:text-brand ${labelCls}`}>
                {c.note}
              </a>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <WatchDialog
          saveId={editing}
          onClose={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </section>
  );
}
