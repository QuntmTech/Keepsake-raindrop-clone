import { useEffect, useMemo, useRef, useState } from 'react';
import { aiAvailable, watchAiSettings } from '@/lib/ai';
import {
  DEFAULT_WRITER_DRAFT,
  getWriterDraft,
  runWriter,
  setWriterDraft,
  type WriterDraft,
} from '@/lib/aiWriter';
import {
  summarizeWriterChanges,
  writerActionLabel,
  type WriterAction,
  type WriterLength,
  type WriterTone,
} from '@/lib/aiWriterPrompt';
import { findByUrl, updateBookmark } from '@/lib/bookmarks';
import {
  send,
  type AiSelectionReplaceResult,
  type AiSelectionResult,
  type SaveCurrentPageResult,
} from '@/lib/messaging';
import { Icon } from './Icon';

const ACTIONS: Array<{ action: WriterAction; label: string }> = [
  { action: 'improve', label: 'Improve' },
  { action: 'grammar', label: 'Grammar' },
  { action: 'rewrite', label: 'Rewrite' },
  { action: 'shorten', label: 'Shorten' },
  { action: 'expand', label: 'Expand' },
  { action: 'simplify', label: 'Simplify' },
  { action: 'professional', label: 'Professional' },
  { action: 'casual', label: 'Casual' },
];

interface ActivePage {
  id?: number;
  url: string;
  title: string;
}

async function activePage(): Promise<ActivePage> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id, url: tab?.url ?? '', title: tab?.title ?? tab?.url ?? 'Untitled page' };
}

async function readPageSelection(): Promise<AiSelectionResult | null> {
  const tab = await activePage();
  if (!tab.id) return null;
  return browser.tabs.sendMessage(tab.id, { type: 'KS_AI_SELECTION_GET' }).catch(() => null) as Promise<AiSelectionResult | null>;
}

export function AIWriter({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [draft, setDraft] = useState<WriterDraft>(DEFAULT_WRITER_DRAFT);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [selection, setSelection] = useState<AiSelectionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [undoAvailable, setUndoAvailable] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getWriterDraft(), aiAvailable(), readPageSelection()])
      .then(([stored, hasAi, selected]) => {
        if (cancelled) return;
        const next = selected?.text && !stored.input ? { ...stored, input: selected.text } : stored;
        setDraft(next);
        setAvailable(hasAi);
        setSelection(selected);
        if (next !== stored) setWriterDraft(next).catch(() => {});
      })
      .finally(() => !cancelled && setReady(true));
    const unwatch = watchAiSettings(() => aiAvailable().then(setAvailable).catch(() => setAvailable(false)));
    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setWriterDraft(draft).catch(() => {}), 180);
    return () => window.clearTimeout(timer);
  }, [draft, ready]);

  const changeSummary = useMemo(
    () => (draft.output ? summarizeWriterChanges(draft.input, draft.output) : ''),
    [draft.input, draft.output],
  );

  function patch(patchValue: Partial<WriterDraft>) {
    setDraft((current) => ({ ...current, ...patchValue }));
    setError('');
    setStatus('');
  }

  async function grabSelection() {
    setError('');
    setStatus('');
    const selected = await readPageSelection();
    setSelection(selected);
    if (!selected?.text) {
      setError('Select some text on the webpage, then click this again.');
      return;
    }
    patch({ input: selected.text, output: '' });
    setStatus(selected.editable ? 'Selected editable text loaded.' : 'Selected page text loaded.');
  }

  async function generate(actionOverride?: WriterAction) {
    const action = actionOverride ?? draft.action;
    if (busy || !draft.input.trim()) return;
    if (!available) {
      setError('Add an Anthropic, OpenAI, or Google API key in Settings → AI first.');
      return;
    }

    const id = ++requestId.current;
    setBusy(true);
    setError('');
    setStatus('');
    patch({ action });
    try {
      const output = await runWriter({
        text: draft.input,
        action,
        tone: draft.tone,
        length: draft.length,
        customInstruction: draft.customInstruction,
      });
      if (id !== requestId.current) return;
      patch({ output: output.trim(), action });
      setStatus(`${writerActionLabel(action)} complete.`);
    } catch (cause) {
      if (id !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : 'AI Writer failed. Try again.');
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }

  async function copyOutput() {
    if (!draft.output) return;
    await navigator.clipboard.writeText(draft.output);
    setStatus('Copied to clipboard.');
  }

  async function replaceSelection() {
    if (!draft.output || !selection?.editable) return;
    const page = await activePage();
    if (!page.id) return;
    const response = (await browser.tabs
      .sendMessage(page.id, {
        type: 'KS_AI_SELECTION_REPLACE',
        text: draft.output,
        expectedOriginal: selection.text,
      })
      .catch(() => null)) as AiSelectionReplaceResult | null;
    if (!response?.ok) {
      setError(response?.error || 'That selection changed. Select the text again and retry.');
      return;
    }
    setUndoAvailable(Boolean(response.undoAvailable));
    setStatus('Replaced the selected text.');
    setSelection((current) => (current ? { ...current, text: draft.output } : current));
  }

  async function undoReplacement() {
    const page = await activePage();
    if (!page.id) return;
    const response = (await browser.tabs
      .sendMessage(page.id, { type: 'KS_AI_SELECTION_UNDO' })
      .catch(() => null)) as AiSelectionReplaceResult | null;
    if (!response?.ok) {
      setError(response?.error || 'Nothing could be undone.');
      return;
    }
    setUndoAvailable(false);
    setStatus('Replacement undone.');
  }

  async function saveOutput() {
    if (!draft.output) return;
    setError('');
    const page = await activePage();
    if (!/^https?:\/\//i.test(page.url)) {
      setError('Open a normal webpage before saving this AI result into Keepsake.');
      return;
    }

    const saved = await send<SaveCurrentPageResult>({ type: 'SAVE_CURRENT_PAGE' }).catch(() => null);
    if (!saved?.ok || saved.status === 'blocked') {
      setError(saved?.error || 'The page could not be saved.');
      return;
    }
    if (saved.status === 'queued') {
      await navigator.clipboard.writeText(draft.output).catch(() => {});
      setStatus('Page queued offline. AI result copied so it is not lost.');
      return;
    }

    const bookmark = await findByUrl(page.url).catch(() => null);
    if (!bookmark) {
      setError('The page saved, but the AI result could not be attached yet.');
      return;
    }
    const heading = `AI Writer · ${writerActionLabel(draft.action)}`;
    const block = `${heading}\n${draft.output}`;
    const note = bookmark.note?.trim() ? `${bookmark.note.trim()}\n\n${block}` : block;
    await updateBookmark(bookmark.id, { note });
    setStatus('Saved to this page in Keepsake.');
  }

  if (!ready) return <div className="p-6 text-center text-sm text-ink-faint">Loading AI Writer…</div>;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
              <Icon name="edit" size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">AI Writer</p>
              <p className="truncate text-[11px] text-ink-faint">Rewrite, repair, and reuse text without leaving the page</p>
            </div>
          </div>
          <button className="btn-ghost shrink-0 px-2 text-xs" onClick={grabSelection} title="Load selected text from the webpage">
            Use selection
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {available === false && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-ink-soft">
            <p className="font-medium text-ink">Connect an AI provider</p>
            <p className="mt-1">Your key stays on this device and is sent only to the provider you choose.</p>
            {onOpenSettings && (
              <button className="mt-2 font-medium text-brand hover:underline" onClick={onOpenSettings}>
                Open AI settings →
              </button>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-semibold text-ink">Source text</label>
            <span className="text-[10px] text-ink-faint">{draft.input.length.toLocaleString()} / 24,000</span>
          </div>
          <textarea
            className="min-h-36 w-full resize-y rounded-xl border border-line bg-surface-raised p-3 text-sm leading-relaxed text-ink outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/10"
            value={draft.input}
            maxLength={24_000}
            placeholder="Paste text here, or select text on the webpage and click Use selection…"
            onChange={(event) => patch({ input: event.target.value, output: '' })}
          />
          {selection?.text && (
            <p className="mt-1 text-[10px] text-ink-faint">
              Loaded from {selection.source === 'page' ? 'page text' : 'an editable field'}
              {selection.editable ? ' · replacement available' : ''}
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-ink">Quick actions</p>
          <div className="grid grid-cols-4 gap-1.5">
            {ACTIONS.map(({ action, label }) => (
              <button
                key={action}
                className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition ${
                  draft.action === action
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-line bg-surface-raised text-ink-soft hover:border-brand/40 hover:text-ink'
                }`}
                onClick={() => generate(action)}
                disabled={busy || !draft.input.trim()}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-[11px] font-medium text-ink-soft">
            Tone
            <select
              className="w-full rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-xs text-ink outline-none focus:border-brand"
              value={draft.tone}
              onChange={(event) => patch({ tone: event.target.value as WriterTone })}
            >
              <option value="preserve">Preserve voice</option>
              <option value="confident">Confident</option>
              <option value="friendly">Friendly</option>
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="direct">Direct</option>
            </select>
          </label>
          <label className="space-y-1 text-[11px] font-medium text-ink-soft">
            Length
            <select
              className="w-full rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-xs text-ink outline-none focus:border-brand"
              value={draft.length}
              onChange={(event) => patch({ length: event.target.value as WriterLength })}
            >
              <option value="shorter">Shorter</option>
              <option value="same">About the same</option>
              <option value="longer">Longer</option>
            </select>
          </label>
        </div>

        <details className="rounded-xl border border-line bg-surface-raised p-3">
          <summary className="cursor-pointer text-xs font-medium text-ink">Custom instruction</summary>
          <textarea
            className="mt-3 min-h-20 w-full resize-y rounded-lg border border-line bg-surface p-2.5 text-xs text-ink outline-none focus:border-brand"
            value={draft.customInstruction}
            maxLength={800}
            placeholder="Example: Make this sound like a concise founder update with more urgency."
            onChange={(event) => patch({ customInstruction: event.target.value })}
          />
          <button
            className="btn-primary mt-2 w-full justify-center"
            onClick={() => generate('custom')}
            disabled={busy || !draft.input.trim() || !draft.customInstruction.trim()}
          >
            Run custom instruction
          </button>
        </details>

        <button className="btn-primary w-full justify-center" onClick={() => generate()} disabled={busy || !draft.input.trim()}>
          {busy ? 'Writing…' : `${writerActionLabel(draft.action)} →`}
        </button>

        {error && <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-500">{error}</div>}
        {status && <div className="rounded-xl bg-brand/10 p-3 text-xs text-brand">{status}</div>}

        {draft.output && (
          <div className="rounded-2xl border border-line bg-surface-raised p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-ink">Result</p>
                <p className="text-[10px] text-ink-faint">{changeSummary}</p>
              </div>
              <button className="btn-ghost px-2 text-xs" onClick={() => patch({ output: '' })}>
                Clear
              </button>
            </div>
            <textarea
              className="min-h-40 w-full resize-y rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink outline-none focus:border-brand"
              value={draft.output}
              onChange={(event) => patch({ output: event.target.value })}
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-ghost justify-center" onClick={copyOutput}>
                <Icon name="copy" size={14} /> Copy
              </button>
              <button className="btn-ghost justify-center" onClick={saveOutput}>
                <Icon name="bookmark" size={14} /> Save
              </button>
              <button
                className="btn-ghost justify-center"
                onClick={replaceSelection}
                disabled={!selection?.editable}
                title={selection?.editable ? 'Replace the captured editable selection' : 'Select text inside an editable field first'}
              >
                <Icon name="edit" size={14} /> Replace
              </button>
              <button className="btn-ghost justify-center" onClick={undoReplacement} disabled={!undoAvailable}>
                Undo replace
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
