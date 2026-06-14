import { useMemo, useState } from 'react';
import { Icon } from './Icon';

interface Props {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];      // all known tags for autocomplete
  aiTags?: string[];           // AI-suggested, shown as one-tap chips
  placeholder?: string;
}

export function TagInput({ tags, onChange, suggestions = [], aiTags = [], placeholder }: Props) {
  const [input, setInput] = useState('');

  const add = (t: string) => {
    const tag = t.trim().toLowerCase();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setInput('');
  };
  const remove = (t: string) => onChange(tags.filter((x) => x !== t));

  const matches = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => s.toLowerCase().includes(q) && !tags.includes(s))
      .slice(0, 6);
  }, [input, suggestions, tags]);

  const freshAi = aiTags.filter((t) => !tags.includes(t));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2 py-1.5 focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/20">
        {tags.map((t) => (
          <span key={t} className="chip">
            {t}
            <button onClick={() => remove(t)} className="opacity-60 hover:opacity-100">
              <Icon name="close" size={11} />
            </button>
          </span>
        ))}
        <input
          className="min-w-[80px] flex-1 bg-transparent py-0.5 text-sm text-ink outline-none placeholder:text-ink-faint"
          value={input}
          placeholder={tags.length ? '' : placeholder ?? 'Add tags…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(matches[0] ?? input);
            } else if (e.key === 'Backspace' && !input && tags.length) {
              remove(tags[tags.length - 1]);
            }
          }}
        />
      </div>

      {matches.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matches.map((m) => (
            <button
              key={m}
              onClick={() => add(m)}
              className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-soft hover:border-brand/40 hover:text-brand"
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {freshAi.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
            <Icon name="sparkles" size={11} /> AI
          </span>
          {freshAi.map((m) => (
            <button
              key={m}
              onClick={() => add(m)}
              className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand hover:bg-brand/20"
            >
              + {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
