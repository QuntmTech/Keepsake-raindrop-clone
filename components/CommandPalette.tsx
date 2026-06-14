import { useEffect, useMemo, useRef, useState } from 'react';
import { searchBookmarks, markVisited } from '@/lib/bookmarks';
import { type Bookmark } from '@/lib/types';
import { Icon, type IconName } from './Icon';

interface Command {
  id: string;
  label: string;
  icon: IconName;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands?: Command[];
}

// Spotlight-style launcher: fuzzy bookmark search + quick actions. ⌘K / Ctrl-K.
export function CommandPalette({ open, onClose, commands = [] }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Bookmark[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      searchBookmarks(q, { perPage: 8 }).then(setResults).catch(() => setResults([]));
    }, 140);
    return () => clearTimeout(id);
  }, [q, open]);

  const filteredCommands = useMemo(() => {
    const ql = q.toLowerCase();
    return commands.filter((c) => !ql || c.label.toLowerCase().includes(ql));
  }, [commands, q]);

  const rows = useMemo(
    () => [
      ...filteredCommands.map((c) => ({ kind: 'cmd' as const, cmd: c })),
      ...results.map((b) => ({ kind: 'bm' as const, bm: b })),
    ],
    [filteredCommands, results],
  );

  if (!open) return null;

  const choose = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === 'cmd') row.cmd.run();
    else {
      markVisited(row.bm.id);
      window.open(row.bm.url, '_blank', 'noreferrer');
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-float animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Icon name="search" size={18} className="text-ink-faint" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-ink-faint"
            placeholder="Search bookmarks or run a command…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                choose(active);
              } else if (e.key === 'Escape') {
                onClose();
              }
            }}
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-faint">esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-faint">No matches</p>
          )}
          {rows.map((row, i) => (
            <button
              key={row.kind === 'cmd' ? row.cmd.id : row.bm.id}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${
                i === active ? 'bg-brand/10 text-brand' : 'text-ink-soft hover:bg-surface-sunken'
              }`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {row.kind === 'cmd' ? (
                <>
                  <Icon name={row.cmd.icon} size={16} />
                  <span>{row.cmd.label}</span>
                </>
              ) : (
                <>
                  {row.bm.favicon ? (
                    <img src={row.bm.favicon} alt="" className="h-4 w-4 rounded-sm" />
                  ) : (
                    <Icon name="bookmark" size={16} />
                  )}
                  <span className="truncate text-ink">{row.bm.title}</span>
                  <span className="ml-auto truncate text-xs text-ink-faint">{row.bm.domain}</span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
