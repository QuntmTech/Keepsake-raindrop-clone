import { useCallback, useEffect, useState } from 'react';
import { Favicon } from './Favicon';
import { Icon } from './Icon';
import { type RecallItem, type RecallResult } from '@/lib/recall';

// Ambient Recall surface (side panel): what the library knows about the page
// in the current tab. Exact matches ("you saved this") are visually distinct
// from semantic ones ("you saved things about this").

function ago(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

export function RecallPanel() {
  const [result, setResult] = useState<RecallResult | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const resp = (await browser.runtime.sendMessage({ type: 'KS_GET_RECALL' })) as {
        ok: boolean;
        result: RecallResult | null;
      };
      setResult(resp?.result ?? null);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // The side panel stays docked while the user browses — follow along.
    const onActivated = () => refresh();
    const onUpdated = (_id: number, info: { status?: string }) => {
      if (info.status === 'complete') setTimeout(refresh, 400); // let the matcher finish
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    const poll = setInterval(refresh, 5000);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      clearInterval(poll);
    };
  }, [refresh]);

  const Row = ({ item }: { item: RecallItem }) => (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="flex gap-2.5 rounded-xl border border-line bg-surface-raised p-2.5 transition hover:border-brand/40"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface">
        <Favicon src={item.favicon} size={18} label={item.title} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-1 text-sm font-medium text-ink">{item.title}</span>
        {item.summary && <span className="line-clamp-2 text-xs text-ink-soft">{item.summary}</span>}
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
          {item.domain} · saved {ago(item.createdAt)}
          {item.kind === 'semantic' && item.score != null && (
            <span className="rounded-full bg-brand/10 px-1.5 text-brand">{Math.round(item.score * 100)}% related</span>
          )}
        </span>
      </span>
    </a>
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      {loading ? (
        <p className="py-8 text-center text-sm text-ink-faint">Checking this page…</p>
      ) : !result ? (
        <div className="py-8 text-center text-sm text-ink-faint">
          <p>Nothing yet for this page.</p>
          <p className="mt-2 text-xs">
            Turn on <b>Ambient Recall</b> in Settings to see related saves while you browse. Matching runs entirely
            on your device — no page data ever leaves it.
          </p>
        </div>
      ) : (
        <>
          {result.exact.length > 0 && (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
                <Icon name="check" size={13} /> You saved this page {ago(result.exact[0].createdAt)}
              </p>
              <div className="flex flex-col gap-2">
                {result.exact.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </div>
            </div>
          )}

          {result.semantic.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                You've saved things about this
              </p>
              <div className="flex flex-col gap-2">
                {result.semantic.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </div>
            </div>
          )}

          {result.domainCount > 0 && (
            <p className="text-center text-[11px] text-ink-faint">
              {result.domainCount} save{result.domainCount === 1 ? '' : 's'} from {new URL(result.url).hostname} in your
              library
            </p>
          )}

          {result.total === 0 && (
            <p className="py-8 text-center text-sm text-ink-faint">No related saves for this page.</p>
          )}

          <p className="mt-auto text-center text-[10px] text-ink-faint">Matching runs 100% on-device.</p>
        </>
      )}
    </div>
  );
}
