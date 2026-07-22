import { useEffect, useState } from 'react';
import { deletePrompt, listSavedPrompts, savePrompt, type SavedPrompt } from '@/lib/promptLibrary';
import { Icon } from './Icon';

export function PromptLibrary({ onUse }: { onUse: (prompt: SavedPrompt) => void }) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [editing, setEditing] = useState<SavedPrompt | null>(null);
  const [name, setName] = useState('');
  const [shortcut, setShortcut] = useState('');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function refresh() {
    setPrompts(await listSavedPrompts());
  }

  useEffect(() => {
    refresh();
  }, []);

  function begin(prompt?: SavedPrompt) {
    setEditing(prompt ?? ({ id: '', name: '', shortcut: '', instruction: '', createdAt: 0, updatedAt: 0 } as SavedPrompt));
    setName(prompt?.name ?? '');
    setShortcut(prompt?.shortcut ?? '');
    setInstruction(prompt?.instruction ?? '');
    setError('');
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await savePrompt({ id: editing?.id || undefined, name, shortcut, instruction });
      setEditing(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the prompt.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(prompt: SavedPrompt) {
    if (prompt.builtIn) return;
    await deletePrompt(prompt.id);
    await refresh();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">Prompt Library</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">Save your best instructions and reuse them on any webpage.</p>
        </div>
        <button className="btn-primary shrink-0 px-2.5 py-1.5 text-xs" onClick={() => begin()}>
          <Icon name="plus" size={13} /> New
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {editing && (
          <div className="mb-4 rounded-2xl border border-brand/30 bg-brand/5 p-3">
            <label className="block text-[11px] font-medium text-ink-soft">
              Name
              <input className="input mt-1" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="mt-2 block text-[11px] font-medium text-ink-soft">
              Slash shortcut
              <div className="mt-1 flex items-center rounded-lg border border-line bg-surface-raised px-2 focus-within:border-brand">
                <span className="text-sm text-ink-faint">/</span>
                <input
                  className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-ink outline-none"
                  maxLength={24}
                  value={shortcut}
                  onChange={(event) => setShortcut(event.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase())}
                />
              </div>
            </label>
            <label className="mt-2 block text-[11px] font-medium text-ink-soft">
              Instruction
              <textarea
                className="mt-1 min-h-28 w-full resize-y rounded-lg border border-line bg-surface-raised p-2.5 text-sm text-ink outline-none focus:border-brand"
                maxLength={4000}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
              />
            </label>
            {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
            <div className="mt-3 flex gap-2">
              <button className="btn-ghost flex-1 justify-center" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn-primary flex-1 justify-center" onClick={submit} disabled={busy}>
                {busy ? 'Saving…' : 'Save prompt'}
              </button>
            </div>
          </div>
        )}

        {prompts.map((prompt) => (
          <div key={prompt.id} className="rounded-xl border border-line bg-surface-raised p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs font-semibold text-ink">{prompt.name}</p>
                  {prompt.builtIn && <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[9px] font-medium text-brand">Built in</span>}
                </div>
                <p className="mt-0.5 text-[10px] text-ink-faint">/{prompt.shortcut}</p>
              </div>
              {!prompt.builtIn && (
                <div className="flex shrink-0 gap-1">
                  <button className="rounded p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-ink" onClick={() => begin(prompt)} title="Edit prompt">
                    <Icon name="edit" size={13} />
                  </button>
                  <button className="rounded p-1.5 text-ink-faint hover:bg-red-500/10 hover:text-red-500" onClick={() => remove(prompt)} title="Delete prompt">
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              )}
            </div>
            <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-ink-soft">{prompt.instruction}</p>
            <button className="btn-ghost mt-3 w-full justify-center text-xs" onClick={() => onUse(prompt)}>
              Use in Writer →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
