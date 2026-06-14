import { useState } from 'react';
import { type Bookmark, type Collection } from '@/lib/types';
import { updateBookmark } from '@/lib/bookmarks';
import { TagInput } from './TagInput';
import { Icon } from './Icon';
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
  const [summary, setSummary] = useState(bookmark.summary ?? '');
  const [note, setNote] = useState(bookmark.note ?? '');
  const [tags, setTags] = useState<string[]>(bookmark.tags ?? []);
  const [collection, setCollection] = useState(bookmark.collection ?? '');
  const [favorite, setFavorite] = useState(Boolean(bookmark.favorite));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const updated = await updateBookmark(bookmark.id, {
        title,
        summary: summary || undefined,
        note: note || undefined,
        tags,
        collection: collection || undefined,
        favorite,
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

        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-4">
          <label className="text-xs font-medium text-ink-soft">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label className="text-xs font-medium text-ink-soft">Summary</label>
          <textarea
            className="input resize-none"
            rows={2}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="A short TL;DR"
          />

          <label className="text-xs font-medium text-ink-soft">Tags</label>
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />

          <label className="text-xs font-medium text-ink-soft">Collection</label>
          <select className="input" value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="">No collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </option>
            ))}
          </select>

          <label className="text-xs font-medium text-ink-soft">Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your note" />

          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
            Mark as favorite
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-line p-3">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
