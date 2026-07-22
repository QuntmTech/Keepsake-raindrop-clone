import { useEffect, useState } from 'react';
import { findByUrl, updateBookmark } from '@/lib/bookmarks';
import { type LlmResult } from '@/lib/llm';
import { send, type SaveCurrentPageResult } from '@/lib/messaging';
import { runPageAction, type PageAction, type PageSnapshot } from '@/lib/pageAi';
import { type AiRouteMode } from '@/lib/types';
import { AiResultMeta } from './AiResultMeta';
import { Icon } from './Icon';

const ACTIONS: Array<{ id: PageAction; label: string }> = [
  { id: 'summary', label: 'Summary' },
  { id: 'key-points', label: 'Key points' },
  { id: 'action-items', label: 'Action items' },
  { id: 'explain', label: 'Explain simply' },
  { id: 'translate', label: 'Translate' },
];

async function readCurrentPage(): Promise<PageSnapshot> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active webpage is available.');
  const response = (await browser.tabs.sendMessage(tab.id, { type: 'KS_AI_PAGE_GET' }).catch(() => null)) as
    | { ok?: boolean; page?: PageSnapshot; error?: string }
    | null;
  if (!response?.ok || !response.page) {
    throw new Error(response?.error || 'Keepsake could not read this page. Refresh the webpage and try again.');
  }
  return response.page;
}

export function AIPageTools() {
  const [page, setPage] = useState<PageSnapshot | null>(null);
  const [action, setAction] = useState<PageAction>('summary');
  const [question, setQuestion] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('English');
  const [quality, setQuality] = useState<AiRouteMode>('auto');
  const [output, setOutput] = useState('');
  const [runMeta, setRunMeta] = useState<LlmResult | null>(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  async function refreshPage() {
    setLoadingPage(true);
    setError('');
    try {
      setPage(await readCurrentPage());
    } catch (cause) {
      setPage(null);
      setError(cause instanceof Error ? cause.message : 'Could not read this page.');
    } finally {
      setLoadingPage(false);
    }
  }

  useEffect(() => {
    refreshPage();
  }, []);

  async function run(nextAction = action) {
    if (!page || busy) return;
    setAction(nextAction);
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await runPageAction({
        page,
        action: nextAction,
        question,
        targetLanguage,
        quality,
      });
      setOutput(result.text);
      setRunMeta(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Page AI failed.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setStatus('Copied.');
  }

  async function saveToPage() {
    if (!page || !output) return;
    const saved = await send<SaveCurrentPageResult>({ type: 'SAVE_CURRENT_PAGE' }).catch(() => null);
    if (!saved?.ok || saved.status === 'blocked') {
      setError(saved?.error || 'The current page could not be saved.');
      return;
    }
    if (saved.status === 'queued') {
      await navigator.clipboard.writeText(output).catch(() => {});
      setStatus('Page queued offline. Result copied so it is not lost.');
      return;
    }
    const bookmark = await findByUrl(page.url).catch(() => null);
    if (!bookmark) {
      setError('The page saved, but the AI result could not be attached yet.');
      return;
    }
    const label = ACTIONS.find((item) => item.id === action)?.label || 'Page answer';
    const block = `Page AI · ${label}\n${output}`;
    await updateBookmark(bookmark.id, { note: bookmark.note?.trim() ? `${bookmark.note.trim()}\n\n${block}` : block });
    setStatus('Saved to this page in Keepsake.');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Current page</p>
            <p className="mt-0.5 truncate text-[11px] text-ink-faint">
              {loadingPage ? 'Reading page…' : page?.title || 'No readable page'}
            </p>
          </div>
          <button className="btn-ghost shrink-0 px-2 text-xs" onClick={refreshPage} disabled={loadingPage}>
            <Icon name="refresh" size={13} /> Refresh
          </button>
        </div>
        {page?.selectedText && (
          <div className="mt-2 rounded-lg bg-brand/10 px-2.5 py-2 text-[10px] text-brand">
            Using your selected text ({page.selectedText.length.toLocaleString()} characters)
          </div>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-1.5">
          {ACTIONS.map((item) => (
            <button
              key={item.id}
              className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition ${
                action === item.id ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface-raised text-ink-soft hover:text-ink'
              }`}
              onClick={() => run(item.id)}
              disabled={!page || busy}
            >
              {item.label}
            </button>
          ))}
        </div>

        {action === 'translate' && (
          <label className="block text-[11px] font-medium text-ink-soft">
            Translate to
            <input className="input mt-1" value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} />
          </label>
        )}

        <div className="rounded-xl border border-line bg-surface-raised p-3">
          <label className="text-xs font-semibold text-ink">Ask this page</label>
          <textarea
            className="mt-2 min-h-20 w-full resize-y rounded-lg border border-line bg-surface p-2.5 text-sm text-ink outline-none focus:border-brand"
            value={question}
            placeholder="What does this page say about…?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="btn-primary mt-2 w-full justify-center" onClick={() => run('ask')} disabled={!page || busy || !question.trim()}>
            {busy && action === 'ask' ? 'Thinking…' : 'Ask page'}
          </button>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-ink-soft">Model route</p>
          <div className="grid grid-cols-4 gap-1">
            {(['auto', 'economy', 'balanced', 'best'] as AiRouteMode[]).map((mode) => (
              <button
                key={mode}
                className={`rounded-lg border px-1 py-2 text-[10px] font-medium capitalize ${
                  quality === mode ? 'border-brand bg-brand/10 text-brand' : 'border-line text-ink-faint hover:text-ink'
                }`}
                onClick={() => setQuality(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {busy && <div className="rounded-xl bg-brand/10 p-3 text-center text-xs text-brand">Analyzing the page…</div>}
        {error && <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-500">{error}</div>}
        {status && <div className="rounded-xl bg-brand/10 p-3 text-xs text-brand">{status}</div>}

        {output && (
          <div className="rounded-2xl border border-line bg-surface-raised p-3">
            <textarea
              className="min-h-56 w-full resize-y rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink outline-none focus:border-brand"
              value={output}
              onChange={(event) => setOutput(event.target.value)}
            />
            {runMeta && <div className="mt-2"><AiResultMeta result={runMeta} /></div>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-ghost justify-center" onClick={copy}><Icon name="copy" size={14} /> Copy</button>
              <button className="btn-ghost justify-center" onClick={saveToPage}><Icon name="bookmark" size={14} /> Save</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
