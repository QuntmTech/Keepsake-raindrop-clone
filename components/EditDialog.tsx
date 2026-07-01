import { useState } from 'react';
import { type Bookmark, type Collection } from '@/lib/types';
import { updateBookmark, safeDomain, faviconFor } from '@/lib/bookmarks';
import { useEscape } from '@/hooks/useEscape';
import { TagInput } from './TagInput';
import { Icon } from './Icon';
import { IconPicker } from './IconPicker';
import { WatchDialog } from './WatchDialog';
import { useToast } from './Toast';

interface Props {
  bookmark: Bookmark;
  collections: Collection[];
  allTags: string[];
  onClose: () => void;
  onSaved: (b: Bookmark) => void;
}

export function EditDialog({ bookmark, collections, allTags, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [title, setTitle] = useState(bookmark.title);
  const [url, setUrl] = useState(bookmark.url);
  const [cover, setCover] = useState(bookmark.cover ?? '');
  const [favicon, setFavicon] = useState(bookmark.favicon ?? '');
  const [summary, setSummary] = useState(bookmark.summary ?? '');
  const [note, setNote] = useState(bookmark.note ?? '');
  const [tags, setTags] = useState<string[]>(bookmark.tags ?? []);
  const [collection, setCollection] = useState(bookmark.collection ?? '');
  const [favorite, setFavorite] = useState(Boolean(bookmark.favorite));
  const [pinned, setPinned] = useState(Boolean(bookmark.pinned));
  const [busy, setBusy] = useState(false);
  const [watching, setWatching] = useState(false);
  useEscape(onClose);

  async function save() {
    if (!url.trim()) {
      toast('URL can’t be empty', 'error');
      return;
    }
    setBusy(true);
    try {
      const cleanUrl = url.trim();
      const domain = safeDomain(cleanUrl);
      const updated = await updateBookmark(bookmark.id, {
        title,
        url: cleanUrl,
        domain,
        cover: cover.trim() || undefined,
        // If favicon was cleared, fall back to the domain's favicon.
        favicon: favicon.trim() || faviconFor(domain),
        summary: summary || undefined,
        note: note || undefined,
        tags,
        collection: collection || undefined,
        favorite,
        pinned,
      });
      onSaved(updated);
      toast('Saved', 'success');
      onClose();
    } catch {
      toast('Could not save', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-float animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Edit bookmark</h3>
          <button className="btn-ghost px-2" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="flex max-h-[72vh] flex-col gap-3 overflow-y-auto p-4">
          {/* Cover preview + image URL */}
          <div className="flex gap-3">
            {cover ? (
              <img
                src={cover}
                alt=""
                className="h-16 w-24 shrink-0 rounded-lg border border-line object-cover"
                onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                onLoad={(e) => (e.currentTarget.style.visibility = 'visible')}
              />
            ) : (
              <div className="grid h-16 w-24 shrink-0 place-items-center rounded-lg border border-dashed border-line text-ink-faint">
                <Icon name="image" size={20} />
              </div>
            )}
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-ink-soft">Cover image URL</label>
              <input className="input py-1.5 text-xs" value={cover} onChange={(e) => setCover(e.target.value)} placeholder="https://…/image.jpg" />
              {cover && (
                <button className="self-start text-[11px] text-ink-faint hover:text-red-500" onClick={() => setCover('')}>
                  Remove image
                </button>
              )}
            </div>
          </div>

          <label className="text-xs font-medium text-ink-soft">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label className="text-xs font-medium text-ink-soft">URL</label>
          <input className="input text-xs" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />

          <label className="text-xs font-medium text-ink-soft">Icon — paste a URL or upload an image</label>
          <IconPicker value={favicon} fallback={faviconFor(safeDomain(url))} onChange={setFavicon} />

          <label className="text-xs font-medium text-ink-soft">Summary</label>
          <textarea className="input resize-none" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="A short TL;DR" />

          <label className="text-xs font-medium text-ink-soft">Tags</label>
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />

          <label className="text-xs font-medium text-ink-soft">Collection</label>
          <select className="input" value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="">No collection</option>
            {collections.map((col) => (
              <option key={col.id} value={col.id}>
                {col.icon ? `${col.icon} ` : ''}
                {col.name}
              </option>
            ))}
          </select>

          <label className="text-xs font-medium text-ink-soft">Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your note" />

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
            Mark as favorite
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Show on Home screen
          </label>
        </div>

        <div className="flex items-center gap-2 border-t border-line p-3">
          <button className="btn-outline" onClick={() => setWatching(true)} title="Price drops, content changes, back-in-stock alerts">
            👁 Watch
          </button>
          <div className="flex-1" />
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
      {watching && <WatchDialog saveId={bookmark.id} onClose={() => setWatching(false)} />}
    </div>
  );
}
