import { type Collection } from '@/lib/types';
import { Icon } from './Icon';

interface Props {
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  collections: Collection[];
  busy?: string | null;
  onToggleAll: () => void;
  onMove: (collectionId: string | undefined) => void;
  onAddTag: () => void;
  onFavorite: () => void;
  onRetryAi: () => void;
  onDelete: () => void;
  onDone: () => void;
}

export function BulkActionBar({
  selectedCount,
  visibleCount,
  allVisibleSelected,
  collections,
  busy,
  onToggleAll,
  onMove,
  onAddTag,
  onFavorite,
  onRetryAi,
  onDelete,
  onDone,
}: Props) {
  const disabled = selectedCount === 0 || Boolean(busy);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-brand/20 bg-brand/5 px-5 py-2.5">
      <button className="btn-outline px-2.5 py-1.5" onClick={onToggleAll} disabled={visibleCount === 0 || Boolean(busy)}>
        <span
          className={`grid h-4 w-4 place-items-center rounded border ${
            allVisibleSelected ? 'border-brand bg-brand text-white' : 'border-line bg-surface-raised'
          }`}
        >
          {allVisibleSelected && <Icon name="check" size={11} />}
        </span>
        {allVisibleSelected ? 'Clear visible' : 'Select visible'}
      </button>

      <span className="min-w-20 text-xs font-medium text-ink-soft">
        {selectedCount} selected{busy ? ` · ${busy}` : ''}
      </span>

      <select
        className="rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-sm outline-none disabled:opacity-50"
        value=""
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value;
          if (!value) return;
          onMove(value === '__none__' ? undefined : value);
        }}
        aria-label="Move selected bookmarks"
      >
        <option value="">Move to…</option>
        <option value="__none__">No collection</option>
        {collections.map((collection) => (
          <option key={collection.id} value={collection.id}>
            {collection.parent ? '↳ ' : ''}{collection.name}
          </option>
        ))}
      </select>

      <button className="btn-outline px-2.5 py-1.5" onClick={onAddTag} disabled={disabled} title="Add one tag to every selected bookmark">
        <Icon name="tag" size={14} /> Tag
      </button>
      <button className="btn-outline px-2.5 py-1.5" onClick={onFavorite} disabled={disabled} title="Mark every selected bookmark as a favorite">
        <Icon name="star" size={14} /> Favorite
      </button>
      <button className="btn-outline px-2.5 py-1.5" onClick={onRetryAi} disabled={disabled} title="Retry AI tagging, summary, and filing">
        <Icon name="sparkles" size={14} /> Retry AI
      </button>
      <button
        className="btn-outline border-red-500/40 px-2.5 py-1.5 text-red-500 hover:bg-red-500/10"
        onClick={onDelete}
        disabled={disabled}
      >
        <Icon name="trash" size={14} /> Delete
      </button>

      <button className="ml-auto btn-ghost px-2.5 py-1.5" onClick={onDone} disabled={Boolean(busy)}>
        Done
      </button>
    </div>
  );
}
