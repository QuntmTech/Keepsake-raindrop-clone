import { useState } from 'react';
import { type Collection } from '@/lib/types';
import { Icon } from './Icon';
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
}

const sameFilter = (a: LibraryFilter, b: LibraryFilter) =>
  a.kind === b.kind &&
  (a.kind !== 'collection' || a.id === (b as any).id) &&
  (a.kind !== 'tag' || a.tag === (b as any).tag);

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
}: Props) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(ACCENTS[1].swatch);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function create() {
    if (!newName.trim()) return;
    await onCreate({ name: newName.trim(), color: newColor });
    setNewName('');
    setAdding(false);
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface px-3 py-4">
      <SmartItem
        icon="grid"
        label="All bookmarks"
        count={total}
        active={selected.kind === 'all'}
        onClick={() => onSelect({ kind: 'all' })}
      />
      <SmartItem
        icon="star"
        label="Favorites"
        count={favorites}
        active={selected.kind === 'favorites'}
        onClick={() => onSelect({ kind: 'favorites' })}
      />
      <SmartItem
        icon="highlight"
        label="Highlights"
        count={highlights}
        active={selected.kind === 'highlights'}
        onClick={() => onSelect({ kind: 'highlights' })}
      />
      <SmartItem
        icon="inbox"
        label="Untagged"
        active={selected.kind === 'untagged'}
        onClick={() => onSelect({ kind: 'untagged' })}
      />

      <div className="mb-1 mt-4 flex items-center justify-between px-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Collections
        </span>
        <button
          className="rounded p-0.5 text-ink-faint hover:text-brand"
          onClick={() => setAdding((a) => !a)}
          title="New collection"
        >
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
            onKeyDown={(e) => e.key === 'Enter' && create()}
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
            <button className="btn-primary ml-auto px-2 py-1 text-xs" onClick={create}>
              Add
            </button>
          </div>
        </div>
      )}

      {collections.map((c) => {
        const active = selected.kind === 'collection' && selected.id === c.id;
        return (
          <div key={c.id} className="group/item flex items-center">
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
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: c.color || 'currentColor' }}
                />
                <span className="truncate">
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </span>
                <span className="ml-auto text-xs text-ink-faint">{counts[c.id] ?? 0}</span>
              </button>
            )}
            <div className="flex opacity-0 transition group-hover/item:opacity-100">
              <button
                className="p-1 text-ink-faint hover:text-ink"
                onClick={() => {
                  setEditing(c.id);
                  setEditName(c.name);
                }}
              >
                <Icon name="edit" size={13} />
              </button>
              <button
                className="p-1 text-ink-faint hover:text-red-500"
                onClick={() => {
                  if (confirm(`Delete “${c.name}”? Bookmarks inside are kept.`)) onRemove(c.id);
                }}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        );
      })}

      {tags.length > 0 && (
        <>
          <div className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Tags
          </div>
          <div className="flex flex-wrap gap-1 px-1">
            {tags.slice(0, 24).map((t) => {
              const active = selected.kind === 'tag' && selected.tag === t.tag;
              return (
                <button
                  key={t.tag}
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    active ? 'bg-brand text-white' : 'bg-surface-sunken text-ink-soft hover:text-brand'
                  }`}
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
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
        active ? 'bg-brand/10 font-medium text-brand' : 'text-ink-soft hover:bg-surface-sunken'
      }`}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {typeof count === 'number' && <span className="ml-auto text-xs text-ink-faint">{count}</span>}
    </button>
  );
}
