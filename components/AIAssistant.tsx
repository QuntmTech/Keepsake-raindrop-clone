import { useEffect, useRef, useState } from 'react';
import { markVisited, vaultStats } from '@/lib/bookmarks';
import { aiAvailable, askLibrary, loadAiCorpus, type LibraryAnswer } from '@/lib/ai';
import { type Bookmark } from '@/lib/types';
import { Icon } from './Icon';
import { Favicon } from './Favicon';

interface Turn {
  q: string;
  a?: LibraryAnswer;
  error?: string;
}

// "Ask your library" — retrieves relevant snippets across the complete vault,
// then sends only those sources to the configured AI provider.
export function AIAssistant({ onClose }: { onClose?: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [corpus, setCorpus] = useState<Bookmark[]>([]);
  const [corpusLoading, setCorpusLoading] = useState(true);
  const [libraryTotal, setLibraryTotal] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    aiAvailable().then((value) => !cancelled && setAvailable(value));
    vaultStats().then((stats) => !cancelled && setLibraryTotal(stats.total)).catch(() => {});
    loadAiCorpus()
      .then((items) => !cancelled && setCorpus(items))
      .catch(() => !cancelled && setCorpus([]))
      .finally(() => !cancelled && setCorpusLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function ask(preset?: string) {
    const question = (preset ?? q).trim();
    if (!question || busy || corpusLoading) return;
    setQ('');
    setTurns((t) => [...t, { q: question }]);
    setBusy(true);
    try {
      const answer = await askLibrary(question, corpus);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer } : x)));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed';
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: message } : x)));
    } finally {
      setBusy(false);
    }
  }

  const samples = [
    'What did I save about AI?',
    'Find that article on productivity',
    'Summarize my design bookmarks',
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/10 text-brand">
            <Icon name="sparkles" size={15} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Ask your library</p>
            <p className="text-[11px] text-ink-faint">
              {corpusLoading
                ? 'Preparing library search…'
                : libraryTotal != null
                  ? `${libraryTotal} bookmarks searchable`
                  : 'Searches your complete library'}
            </p>
          </div>
        </div>
        {onClose && (
          <button className="btn-ghost px-2" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {available === false && (
          <div className="rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-soft">
            <p className="mb-1 font-medium text-ink">AI isn’t set up yet</p>
            <p className="text-xs">
              Choose Anthropic, OpenAI, or Google and add your API key in Settings → AI. Your key stays on this device.
            </p>
          </div>
        )}

        {available && corpusLoading && (
          <div className="rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-soft">
            Preparing your complete library for search…
          </div>
        )}

        {turns.length === 0 && available && !corpusLoading && (
          <div className="space-y-2">
            <p className="text-xs text-ink-faint">
              Keepsake searches your full vault first and sends only the most relevant saved sources to your AI provider.
            </p>
            {samples.map((s) => (
              <button
                key={s}
                className="block w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-left text-sm text-ink-soft transition hover:border-brand/40 hover:text-brand"
                onClick={() => ask(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white">
              {t.q}
            </div>
            {t.error ? (
              <div className="rounded-2xl rounded-bl-sm bg-red-500/10 px-3 py-2 text-sm text-red-500">
                {t.error}
              </div>
            ) : t.a ? (
              <div className="space-y-2">
                <div className="w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-sunken px-3 py-2 text-sm text-ink">
                  {t.a.answer}
                </div>
                {t.a.sources.length > 0 && (
                  <div className="space-y-1">
                    {t.a.sources.map((b, sourceIndex) => (
                      <button
                        key={b.id}
                        className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-left transition hover:border-brand/40"
                        onClick={() => {
                          markVisited(b.id);
                          window.open(b.url, '_blank', 'noreferrer');
                        }}
                      >
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-brand/10 text-[10px] font-semibold text-brand">
                          {sourceIndex + 1}
                        </span>
                        <Favicon src={b.favicon} size={16} />
                        <span className="truncate text-xs text-ink-soft">{b.title}</span>
                        <Icon name="external" size={12} className="ml-auto text-ink-faint" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="w-fit rounded-2xl rounded-bl-sm bg-surface-sunken px-3 py-2">
                <div className="flex gap-1">
                  <Dot /> <Dot /> <Dot />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {available && (
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2">
            <input
              className="input"
              placeholder={corpusLoading ? 'Loading your library…' : 'Ask anything about your saves…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
              disabled={corpusLoading}
            />
            <button className="btn-primary px-3" onClick={() => ask()} disabled={busy || corpusLoading || !q.trim()}>
              <Icon name="sparkles" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />;
}
