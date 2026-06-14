import { type Bookmark } from '@/lib/types';

export function BookmarkCard({ bookmark, onDelete }: { bookmark: Bookmark; onDelete?: (id: string) => void }) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      {bookmark.screenshot ? (
        <img src={bookmark.screenshot} alt="" className="h-32 w-full object-cover" />
      ) : (
        <div className="flex h-32 w-full items-center justify-center bg-gray-100 text-3xl dark:bg-gray-700">
          🔖
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 p-3">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noreferrer"
          className="line-clamp-2 text-sm font-medium text-gray-900 hover:text-brand dark:text-gray-100"
        >
          {bookmark.title}
        </a>
        <span className="text-xs text-gray-400">{bookmark.domain}</span>
        {bookmark.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {bookmark.tags.map((t) => (
              <span key={t} className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
      {onDelete && (
        <button
          className="px-3 py-1 text-left text-[11px] text-red-400 opacity-0 transition group-hover:opacity-100"
          onClick={() => onDelete(bookmark.id)}
        >
          Delete
        </button>
      )}
    </div>
  );
}
