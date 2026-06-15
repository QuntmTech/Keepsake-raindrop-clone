import { type Bookmark, type BookmarkType, type ViewMode } from '@/lib/types';
import { markVisited } from '@/lib/bookmarks';
import { Icon, type IconName } from './Icon';
import { Favicon } from './Favicon';

const TYPE_ICON: Record<BookmarkType, IconName> = {
  article: 'doc',
  video: 'video',
  image: 'image',
  pdf: 'pdf',
  repo: 'repo',
  doc: 'doc',
  link: 'link',
};

interface Props {
  bookmark: Bookmark;
  layout?: ViewMode;
  onDelete?: (id: string) => void;
  onToggleFavorite?: (b: Bookmark) => void;
  onEdit?: (b: Bookmark) => void;
  onRead?: (b: Bookmark) => void;
}

export function BookmarkCard({ bookmark, layout = 'grid', onDelete, onToggleFavorite, onEdit, onRead }: Props) {
  const open = () => {
    markVisited(bookmark.id);
    window.open(bookmark.url, '_blank', 'noreferrer');
  };

  // Drag a card onto a collection in the sidebar to file it there.
  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', bookmark.id);
      e.dataTransfer.effectAllowed = 'move';
    },
  };

  const Cover = ({ className }: { className: string }) =>
    bookmark.cover || bookmark.screenshot ? (
      <img
        src={bookmark.cover || bookmark.screenshot}
        alt=""
        loading="lazy"
        draggable={false}
        className={`${className} object-cover`}
        onError={(e) => ((e.currentTarget.style.display = 'none'))}
      />
    ) : (
      <div className={`${className} grid place-items-center bg-surface-sunken text-ink-faint`}>
        <Icon name={TYPE_ICON[bookmark.type]} size={layout === 'list' ? 20 : 28} />
      </div>
    );

  const Actions = () => (
    <div className="flex items-center gap-0.5">
      {onRead && bookmark.content && (
        <button
          className="rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-surface-sunken hover:text-ink group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRead(bookmark);
          }}
          title="Read saved copy"
        >
          <Icon name="doc" size={15} />
        </button>
      )}
      {onToggleFavorite && (
        <button
          className={`rounded-md p-1.5 transition hover:bg-surface-sunken ${
            bookmark.favorite ? 'text-amber-400' : 'text-ink-faint opacity-0 group-hover:opacity-100'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(bookmark);
          }}
          title="Favorite"
        >
          <Icon name={bookmark.favorite ? 'star-fill' : 'star'} size={15} />
        </button>
      )}
      {onEdit && (
        <button
          className="rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-surface-sunken hover:text-ink group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(bookmark);
          }}
          title="Edit"
        >
          <Icon name="edit" size={15} />
        </button>
      )}
      {onDelete && (
        <button
          className="rounded-md p-1.5 text-ink-faint opacity-0 transition hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(bookmark.id);
          }}
          title="Delete"
        >
          <Icon name="trash" size={15} />
        </button>
      )}
    </div>
  );

  if (layout === 'list') {
    return (
      <div
        className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2.5 transition hover:border-brand/30 hover:shadow-card"
        onClick={open}
        {...dragProps}
      >
        <Cover className="h-11 w-11 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Favicon src={bookmark.favicon} size={14} />
            <span className="truncate text-sm font-medium text-ink">{bookmark.title}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
            <span className="truncate">{bookmark.domain}</span>
            {bookmark.readingTime ? <span>· {bookmark.readingTime} min</span> : null}
            {bookmark.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-brand">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <Actions />
      </div>
    );
  }

  // grid / masonry card
  return (
    <div
      className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-card transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-float"
      onClick={open}
      {...dragProps}
    >
      <div className="relative">
        <Cover className={layout === 'masonry' ? 'h-auto max-h-64 w-full' : 'h-32 w-full'} />
        <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-md bg-black/45 text-white backdrop-blur-sm">
          <Icon name={TYPE_ICON[bookmark.type]} size={13} />
        </span>
        <div className="absolute right-1.5 top-1.5 rounded-lg bg-surface-raised/85 backdrop-blur-sm">
          <Actions />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5">
          <Favicon src={bookmark.favicon} size={14} />
          <span className="truncate text-xs text-ink-faint">{bookmark.domain}</span>
        </div>
        <span className="line-clamp-2 text-sm font-medium text-ink">{bookmark.title}</span>
        {bookmark.summary && (
          <p className="line-clamp-2 text-xs text-ink-soft">{bookmark.summary}</p>
        )}
        {bookmark.tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1 pt-1">
            {bookmark.tags.slice(0, 4).map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
