import { type Bookmark } from '@/lib/types';
import { markVisited } from '@/lib/bookmarks';
import { useEscape } from '@/hooks/useEscape';
import { Icon } from './Icon';
import { Favicon } from './Favicon';

// A distraction-free reader for the cached page text — so a saved page is still
// readable even if the original site changes or goes offline (link-rot proof).
export function ReaderView({ bookmark, onClose }: { bookmark: Bookmark; onClose: () => void }) {
  useEscape(onClose);
  const paragraphs = (bookmark.content ?? '')
    .split(/\n+|(?<=\.)\s{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="my-6 h-fit w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-float animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Favicon src={bookmark.favicon} size={16} />
          <span className="truncate text-sm font-medium text-ink">{bookmark.domain}</span>
          <a
            href={bookmark.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => markVisited(bookmark.id)}
            className="ml-auto flex items-center gap-1 text-xs text-ink-faint hover:text-brand"
          >
            Open original <Icon name="external" size={12} />
          </a>
          <button className="btn-ghost px-2" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <article className="max-h-[75vh] overflow-y-auto px-6 py-5">
          <h1 className="mb-1 text-xl font-semibold text-ink">{bookmark.title}</h1>
          {bookmark.summary && <p className="mb-4 text-sm italic text-ink-soft">{bookmark.summary}</p>}
          {paragraphs.length > 0 ? (
            <div className="space-y-3 text-[15px] leading-relaxed text-ink-soft">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-faint">
              No cached text for this bookmark. Pages saved from now on will keep a readable copy.
            </p>
          )}
        </article>
      </div>
    </div>
  );
}
