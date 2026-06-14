import { useEffect, useRef, useState } from 'react';
import { searchBookmarks, markVisited } from '@/lib/bookmarks';
import { aiAvailable, askLibrary, type LibraryAnswer } from '@/lib/ai';
import { type Bookmark } from '@/lib/types';
import { Icon } from './Icon';

interface Turn {
  q: string;
  a?: LibraryAnswer;
  error?: string;
}

// "Ask your library" — natural-language Q&A grounded in the user's own bookmarks.
export function AIAssistant({ onClose }: { onClose?: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [corpus, setCorpus] = useState<Bookmark[]>([]);
  const [q, setQ] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aiAvailable().then(setAvailable);
    searchBookmarks('', { perPage: 200 }).then(setCorpus).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function ask() {
    const question = q.trim();
    if (!question || busy) return;
    setQ('');
    setTurns((t) => [...t, { q: question }]);
    setBusy(true);
    try {
      const answer = await askLibrary(question, corpus);
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: answer } : x)));
    } catch (e: any) {
      setTurns((t) =>
        t.map((x, i) => (i === t.length - 1 ? { ...x, error: e?.message ?? 'Failed' } : x)),
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
            <p className="text-[11px] text-ink-faint">{corpus.length} bookmarks in context</p>
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
              Add your Anthropic API key in Settings → AI to ask questions across everything you’ve
              saved.
            </p>
          </div>
        )}

        {turns.length === 0 && available && (
          <div className="space-y-2">
            <p className="text-xs text-ink-faint">Try asking:</p>
            {samples.map((s) => (
              <button
                key={s}
                className="block w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-left text-sm text-ink-soft transition hover:border-brand/40 hover:text-brand"
                onClick={() => {
                  setQ(s);
                }}
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
                    {t.a.sources.map((b) => (
                      <button
                        key={b.id}
                        className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-left transition hover:border-brand/40"
                        onClick={() => {
                          markVisited(b.id);
                          window.open(b.url, '_blank', 'noreferrer');
                        }}
                      >
                        {b.favicon && <img src={b.favicon} alt="" className="h-4 w-4 rounded-sm" />}
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
              placeholder="Ask anything about your saves…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
            />
            <button className="btn-primary px-3" onClick={ask} disabled={busy || !q.trim()}>
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
