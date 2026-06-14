import { useState } from 'react';
import { type Collection } from '@/lib/types';
import { Icon, type IconName } from './Icon';
import { ACCENTS } from '@/lib/theme';

export type LibraryFilter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'untagged' }
  | { kind: 'highlights' }
  | { kind: 'collection'; id: string }
  | { kind: 'tag'; tag: string };

interface Props {
  collections: Collection[];
  counts: Record<string, number>;
  total: number;
  favorites: number;
  highlights: number;
  tags: { tag: string; count: number }[];
  selected: LibraryFilter;
  onSelect: (f: LibraryFilter) => void;
  onCreate: (data: { name: string; color?: string; icon?: string }) => Promise<unknown>;
  onRename: (id: string, patch: Partial<Collection>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  // Drag-and-drop: move a bookmark into a collection (undefined = remove from any).
  onMove?: (bookmarkId: string, collectionId: string | undefined) => void;
  compact?: boolean;
}

export function CollectionSidebar({
  collections,
  counts,
  total,
  favorites,
  highlights,
  tags,
  selected,
  onSelect,
  onCreate,
  onRename,
  onRemove,
  onMove,
  compact,
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(ACCENTS[1].swatch);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [dropKey, setDropKey] = useState<string | null>(null);

  async function create() {
    if (!newName.trim()) return;
    await onCreate({ name: newName.trim(), color: newColor });
    setNewName('');
    setAdding(false);
  }

  // Build drag-drop handlers for a target (collection id, or undefined = unsort).
  const dropFor = (key: string, collectionId: string | undefined) =>
    onMove
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (dropKey !== key) setDropKey(key);
          },
          onDragLeave: () => setDropKey((k) => (k === key ? null : k)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const id = e.dataTransfer.getData('text/plain');
            setDropKey(null);
            if (id) onMove(id, collectionId);
          },
        }
      : {};

  return (
    <aside
      className={`flex h-full shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface py-3 ${
        compact ? 'w-44 px-2' : 'w-60 px-3 py-4'
      }`}
    >
      <SmartItem
        icon="grid"
        label="All bookmarks"
        count={total}
        active={selected.kind === 'all'}
        onClick={() => onSelect({ kind: 'all' })}
        dropActive={dropKey === 'all'}
        dragProps={dropFor('all', undefined)}
      />
      <SmartItem icon="star" label="Favorites" count={favorites} active={selected.kind === 'favorites'} onClick={() => onSelect({ kind: 'favorites' })} />
      <SmartItem icon="highlight" label="Highlights" count={highlights} active={selected.kind === 'highlights'} onClick={() => onSelect({ kind: 'highlights' })} />
      <SmartItem icon="inbox" label="Unsorted" active={selected.kind === 'untagged'} onClick={() => onSelect({ kind: 'untagged' })} />

      <div className="mb-1 mt-4 flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Collections</span>
        <button className="rounded p-0.5 text-ink-faint hover:text-brand" onClick={() => setAdding((a) => !a)} title="New collection">
          <Icon name="plus" size={15} />
        </button>
      </div>

      {adding && (
        <div className="mb-1 flex flex-col gap-1.5 rounded-lg border border-line bg-surface-raised p-2">
          <input
            className="input py-1.5 text-sm"
            placeholder="Collection name"
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
              else if (e.key === 'Escape') setAdding(false);
            }}
          />
          <div className="flex items-center gap-1.5">
            {ACCENTS.map((a) => (
              <button
                key={a.key}
                className={`h-5 w-5 rounded-full ${newColor === a.swatch ? 'ring-2 ring-offset-1 ring-offset-surface-raised' : ''}`}
                style={{ background: a.swatch, ['--tw-ring-color' as any]: a.swatch }}
                onClick={() => setNewColor(a.swatch)}
              />
            ))}
            <button className="btn-primary ml-auto px-2 py-1 text-xs" onClick={create}>Add</button>
          </div>
        </div>
      )}

      {collections.map((c) => {
        const active = selected.kind === 'collection' && selected.id === c.id;
        const isDrop = dropKey === c.id;
        return (
          <div
            key={c.id}
            className={`group/item flex items-center rounded-lg ${isDrop ? 'ring-2 ring-brand ring-inset bg-brand/5' : ''}`}
            {...dropFor(c.id, c.id)}
          >
            {editing === c.id ? (
              <input
                className="input py-1 text-sm"
                value={editName}
                autoFocus
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => setEditing(null)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    await onRename(c.id, { name: editName.trim() || c.name });
                    setEditing(null);
                  } else if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <button
                className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                  active ? 'bg-brand/10 font-medium text-brand' : 'text-ink-soft hover:bg-surface-sunken'
                }`}
                onClick={() => onSelect({ kind: 'collection', id: c.id })}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color || 'currentColor' }} />
                <span className="truncate">{c.icon ? `${c.icon} ` : ''}{c.name}</span>
                <span className="ml-auto text-xs text-ink-faint">{counts[c.id] ?? 0}</span>
              </button>
            )}
            <div className="flex opacity-0 transition group-hover/item:opacity-100">
              <button className="p-1 text-ink-faint hover:text-ink" onClick={() => { setEditing(c.id); setEditName(c.name); }} title="Rename">
                <Icon name="edit" size={13} />
              </button>
              <button
                className="p-1 text-ink-faint hover:text-red-500"
                title="Delete"
                onClick={() => { if (confirm(`Delete “${c.name}”? Bookmarks inside are kept.`)) onRemove(c.id); }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        );
      })}

      {/* Prominent create button (besides the small + in the header) */}
      <button
        className="mt-1.5 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-line px-2 py-2 text-xs font-medium text-ink-faint transition hover:border-brand/50 hover:text-brand"
        onClick={() => setAdding(true)}
      >
        <Icon name="plus" size={14} /> New collection
      </button>

      {tags.length > 0 && (
        <>
          <div className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Tags</div>
          <div className="flex flex-wrap gap-1 px-1">
            {tags.slice(0, compact ? 14 : 24).map((t) => {
              const active = selected.kind === 'tag' && selected.tag === t.tag;
              return (
                <button
                  key={t.tag}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${active ? 'bg-brand text-white' : 'bg-surface-sunken text-ink-soft hover:text-brand'}`}
                  onClick={() => onSelect({ kind: 'tag', tag: t.tag })}
                >
                  {t.tag}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="h-4" />
    </aside>
  );
}

function SmartItem({
  icon,
  label,
  count,
  active,
  onClick,
  dropActive,
  dragProps,
}: {
  icon: IconName;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  dropActive?: boolean;
  dragProps?: Record<string, unknown>;
}) {
  return (
    <button
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
        active ? 'bg-brand/10 font-medium text-brand' : 'text-ink-soft hover:bg-surface-sunken'
      } ${dropActive ? 'ring-2 ring-brand ring-inset bg-brand/5' : ''}`}
      onClick={onClick}
      {...dragProps}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {typeof count === 'number' && <span className="ml-auto text-xs text-ink-faint">{count}</span>}
    </button>
  );
}
