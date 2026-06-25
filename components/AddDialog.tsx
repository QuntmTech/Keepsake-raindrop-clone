import { useState } from 'react';
import { type Collection } from '@/lib/types';
import { saveBookmark, safeDomain, inferType, faviconFor } from '@/lib/bookmarks';
import { useEscape } from '@/hooks/useEscape';
import { TagInput } from './TagInput';
import { Icon } from './Icon';
import { useToast } from './Toast';

interface Props {
  collections: Collection[];
  allTags: string[];
  defaultCollection?: string;
  favorite?: boolean;
  onClose: () => void;
  onAdded: () => void;
}

// Add a bookmark by URL from the dashboard (no active tab needed).
export function AddDialog({ collections, allTags, defaultCollection, favorite, onClose, onAdded }: Props) {
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [collection, setCollection] = useState(defaultCollection ?? '');
  const [busy, setBusy] = useState(false);
  useEscape(onClose);

  async function add() {
    let clean = url.trim();
    if (!clean) return;
    if (!/^https?:\/\//i.test(clean)) clean = `https://${clean}`;
    setBusy(true);
    try {
      const domain = safeDomain(clean);
      await saveBookmark({
        url: clean,
        title: title.trim() || domain || clean,
        tags,
        collection: collection || undefined,
        favorite,
        domain,
        type: inferType(clean),
        favicon: faviconFor(domain),
      });
      toast('Added to your vault', 'success');
      onAdded();
      onClose();
    } catch {
      toast('Could not add bookmark', 'error');
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
          <h3 className="text-sm font-semibold text-ink">New bookmark</h3>
          <button className="btn-ghost px-2" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <input
            className="input"
            placeholder="https://example.com"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <input
            className="input"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />
          <select className="input" value={collection} onChange={(e) => setCollection(e.target.value)}>
            <option value="">No collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t border-line p-3">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={add} disabled={busy || !url.trim()}>
            {busy ? 'Adding…' : 'Add bookmark'}
          </button>
        </div>
      </div>
    </div>
  );
}
