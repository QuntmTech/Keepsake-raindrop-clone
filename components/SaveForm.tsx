import { useEffect, useState } from 'react';
import { saveBookmark, listCollections } from '@/lib/bookmarks';
import { send, dataUrlToBlob, type ScreenshotResult } from '@/lib/messaging';
import { getSettings } from '@/lib/settings';
import { type Collection } from '@/lib/types';

// Reads the active tab, lets the user add tags + pick a collection, captures a preview
// screenshot via the background worker, and saves to PocketBase.
export function SaveForm({ onSaved }: { onSaved?: () => void }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      setTitle(tab?.title ?? '');
      setUrl(tab?.url ?? '');
      try {
        setCollections(await listCollections());
      } catch {
        /* not logged in */
      }
      const s = await getSettings();
      if (s.defaultCollection) setCollection(s.defaultCollection);
    })();
  }, []);

  async function save() {
    setBusy(true);
    try {
      const settings = await getSettings();
      let screenshotBlob: Blob | undefined;
      if (settings.enableAutoScreenshot) {
        try {
          const res = await send<ScreenshotResult>({ type: 'CAPTURE_SCREENSHOT' });
          if (res?.dataUrl) screenshotBlob = dataUrlToBlob(res.dataUrl);
        } catch {
          /* capture failed, save without preview */
        }
      }
      await saveBookmark({
        url,
        title,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        collection: collection || undefined,
        screenshotBlob,
      });
      setDone(true);
      onSaved?.();
      setTimeout(() => setDone(false), 1500);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <input
        className="rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
      />
      <input
        className="truncate rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL"
      />
      <input
        className="rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="tags, comma, separated"
      />
      <select
        className="rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        value={collection}
        onChange={(e) => setCollection(e.target.value)}
      >
        <option value="">No collection</option>
        {collections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        className="rounded bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        onClick={save}
        disabled={busy}
      >
        {done ? 'Saved ✓' : busy ? 'Saving…' : 'Save page'}
      </button>
    </div>
  );
}
