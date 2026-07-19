import { useEffect, useRef, useState } from 'react';
import { markVisited, vaultStats, watchVault } from '@/lib/bookmarks';
import {
  aiAvailable,
  askLibrary,
  loadAiCorpus,
  watchAiSettings,
  type LibraryAnswer,
  type LibraryTurnContext,
} from '@/lib/ai';
import { type Bookmark } from '@/lib/types';
import { Icon } from './Icon';
import { Favicon } from './Favicon';

interface Turn {
  q: string;
  a?: LibraryAnswer;
  error?: string;
}

// "Ask your library" — retrieves relevant snippets across the complete vault,
// then sends only those sources to the configured AI provider. Without a key,
// the same retrieval layer still returns useful local matches.
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

  // Settings can change from another Keepsake surface while this panel remains
  // open. Reflect key/provider changes immediately instead of requiring reload.
  useEffect(
    () =>
      watchAiSettings(() => {
        aiAvailable().then(setAvailable).catch(() => setAvailable(false));
      }),
    [],
  );

  // Keep the searchable seed and count current if saves are added/edited/deleted
  // from the Quick Bar, popup, dashboard, or another tab.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unwatch = watchVault(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        loadAiCorpus().then(setCorpus).catch(() => {});
        vaultStats().then((stats) => setLibraryTotal(stats.total)).catch(() => {});
      }, 250);
    });
    return () => {
      clearTimeout(timer);
      unwatch();
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function ask(preset?: string) {
    const question = (preset ?? q).trim();
    if (!question || busy || corpusLoading) return;

    const history: LibraryTurnContext[] = turns
      .filter((turn): turn is Turn & { a: LibraryAnswer } => Boolean(turn.a))
      .slice(-4)
      .map((turn) => ({ question: turn.q, answer: turn.a.answer }));

    setQ('');
    setTurns((current) => [...current, { q: question }]);
    setBusy(true);
    try {
      const answer = await askLibrary(question, corpus, history);
      setTurns((current) =>
        current.map((turn, index) => (index === current.length - 1 ? { ...turn, a: answer } : turn)),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed';
      setTurns((current) =>
        current.map((turn, index) => (index === current.length - 1 ? { ...turn, error: message } : turn)),
      );
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
        <div className="flex items-center gap-1">
          {turns.length > 0 && (
            <button
              className="btn-ghost px-2 text-xs"
              onClick={() => setTurns([])}
              disabled={busy}
              title="Clear this conversation"
            >
              Clear
            </button>
          )}
          {onClose && (
            <button className="btn-ghost px-2" onClick={onClose}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {available === false && (
          <div className="rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-soft">
            <p className="mb-1 font-medium text-ink">Local library search is ready</p>
            <p className="text-xs">
              Ask anything now and Keepsake will show the strongest matching saves. Add an Anthropic, OpenAI, or Google key in Settings → AI for synthesized answers with citations.
            </p>
          </div>
        )}

        {corpusLoading && (
          <div className="rounded-xl border border-line bg-surface-sunken p-4 text-sm text-ink-soft">
            Preparing your complete library for search…
          </div>
        )}

        {turns.length === 0 && !corpusLoading && (
          <div className="space-y-2">
            <p className="text-xs text-ink-faint">
              Keepsake searches your full vault first and sends only the most relevant saved sources to your selected AI provider when one is configured.
            </p>
            {samples.map((sample) => (
              <button
                key={sample}
                className="block w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-left text-sm text-ink-soft transition hover:border-brand/40 hover:text-brand"
                onClick={() => ask(sample)}
              >
                {sample}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, turnIndex) => (
          <div key={turnIndex} className="space-y-2">
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white">
              {turn.q}
            </div>
            {turn.error ? (
              <div className="space-y-1">
                <div className="rounded-2xl rounded-bl-sm bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  {turn.error}
                </div>
                <button className="text-xs text-brand hover:underline" onClick={() => ask(turn.q)} disabled={busy}>
                  Try again
                </button>
              </div>
            ) : turn.a ? (
              <div className="space-y-2">
                <div className="w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-surface-sunken px-3 py-2 text-sm text-ink">
                  {turn.a.answer}
                </div>
                {turn.a.degraded && (
                  <p className="px-1 text-[11px] text-amber-600 dark:text-amber-400">
                    Showing local matches. Add or check your AI provider in Settings for a synthesized answer.
                  </p>
                )}
                {turn.a.sources.length > 0 && (
                  <div className="space-y-1">
                    {turn.a.sources.map((bookmark, sourceIndex) => {
                      const snippet = turn.a?.snippets[sourceIndex]?.trim();
                      return (
                        <button
                          key={bookmark.id}
                          className="flex w-full items-start gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-left transition hover:border-brand/40"
                          onClick={() => {
                            markVisited(bookmark.id);
                            window.open(bookmark.url, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-brand/10 text-[10px] font-semibold text-brand">
                            {sourceIndex + 1}
                          </span>
                          <Favicon src={bookmark.favicon} size={16} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-ink-soft">{bookmark.title}</span>
                            {snippet && (
                              <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-faint">
                                {snippet}
                              </span>
                            )}
                          </span>
                          <Icon name="external" size={12} className="mt-0.5 shrink-0 text-ink-faint" />
                        </button>
                      );
                    })}
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

      {available !== null && (
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2">
            <input
              className="input"
              placeholder={corpusLoading ? 'Loading your library…' : 'Ask anything about your saves…'}
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                const native = event.nativeEvent as KeyboardEvent;
                if (event.key === 'Enter' && !native.isComposing) ask();
              }}
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
