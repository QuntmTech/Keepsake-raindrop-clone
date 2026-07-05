import { type Bookmark, type ViewMode } from '@/lib/types';
import { BookmarkCard } from './BookmarkCard';
import { Icon } from './Icon';

interface Props {
  items: Bookmark[];
  loading?: boolean;
  view?: ViewMode;
  onDelete?: (id: string) => void;
  onToggleFavorite?: (b: Bookmark) => void;
  onEdit?: (b: Bookmark) => void;
  onRead?: (b: Bookmark) => void;
  emptyHint?: string;
}

export function BookmarkGrid({
  items,
  loading,
  view = 'grid',
  onDelete,
  onToggleFavorite,
  onEdit,
  onRead,
  emptyHint,
}: Props) {
  if (loading) {
    return (
      <div className={containerClass(view)}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-48 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-sunken text-ink-faint">
          <Icon name="inbox" size={26} />
        </span>
        <p className="text-sm font-medium text-ink-soft">Nothing here yet</p>
        <p className="max-w-xs text-xs text-ink-faint">
          {emptyHint ?? 'Save a page with the toolbar icon or right-click → “Save page to vault”.'}
        </p>
      </div>
    );
  }

  if (view === 'masonry') {
    return (
      <div className="columns-2 gap-4 [column-fill:_balance] sm:columns-3 lg:columns-4">
        {items.map((b) => (
          <div key={b.id} className="mb-4 break-inside-avoid">
            <BookmarkCard
              bookmark={b}
              layout="masonry"
              onDelete={onDelete}
              onToggleFavorite={onToggleFavorite}
              onEdit={onEdit}
            onRead={onRead}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={containerClass(view)}>
      {items.map((b) => (
        <BookmarkCard
          key={b.id}
          bookmark={b}
          layout={view}
          onDelete={onDelete}
          onToggleFavorite={onToggleFavorite}
          onEdit={onEdit}
        onRead={onRead}
        />
      ))}
    </div>
  );
}

function containerClass(view: ViewMode): string {
  if (view === 'list') return 'flex flex-col gap-2';
  return 'grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4';
}
