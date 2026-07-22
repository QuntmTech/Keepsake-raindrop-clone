import { useEffect, useState } from 'react';
import {
  saveBookmark,
  listCollections,
  createCollection,
  getAllTags,
  findByUrl,
  inferType,
  safeDomain,
} from '@/lib/bookmarks';
import { enqueueSave } from '@/lib/queue';
import { send, dataUrlToBlob, type ScreenshotResult, type MetaResult } from '@/lib/messaging';
import { getSettings } from '@/lib/settings';
import { aiAvailable, getAiSettings, suggestTags, summarize, type PageContext } from '@/lib/ai';
import { canSaveBookmark, storageRemaining } from '@/lib/entitlements';
import { resolveSaveCollection } from '@/lib/uiContext';
import { type Collection } from '@/lib/types';
import { type PageMeta } from '@/lib/metadata';
import { TagInput } from './TagInput';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { UpgradeDialog } from './UpgradeDialog';

interface SaveFormProps {
  onSaved?: () => void;
  // undefined = use the global default; null = explicitly save Unsorted;
  // string = prefer the collection currently open in the surrounding UI.
  initialCollection?: string | null;
}

// Reads the active tab, enriches it, lets the user tweak it, and saves it.
export function SaveForm({ onSaved, initialCollection }: SaveFormProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [summary, setSummary] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [aiTags, setAiTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [existing, setExisting] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);

  async function createFolder() {
    const name = newFolder.trim();
    if (!name) return;
    try {
      const created = await createCollection({ name });
      setCollections((previous) => [...previous, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCollection(created.id);
      setNewFolder('');
      setCreatingFolder(false);
      toast(`Folder “${name}” created`, 'success');
    } catch {
      toast('Could not create folder', 'error');
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tab?.url ?? '';
      const tabTitle = tab?.title ?? '';
      if (!active) return;
      setTitle(tabTitle);
      setUrl(tabUrl);

      let tagNames: string[] = [];
      let cols: Collection[] = [];
      try {
        cols = await listCollections();
        tagNames = (await getAllTags()).map((item) => item.tag);
        if (!active) return;
        setCollections(cols);
        setAllTags(tagNames);
      } catch {
        /* not logged in */
      }

      const settings = await getSettings();
      if (!active) return;
      setCollection(resolveSaveCollection(initialCollection, settings.defaultCollection, cols.map((item) => item.id)));

      try {
        const found = tabUrl ? await findByUrl(tabUrl) : null;
        if (active && found) setExisting(true);
      } catch {
        /* ignore */
      }

      let pageMeta: PageMeta | null = null;
      if (settings.enableMetadata && tab?.id) {
        try {
          const response = await send<MetaResult>({ type: 'EXTRACT_META', tabId: tab.id });
          pageMeta = response?.meta ?? null;
          if (!active) return;
          setMeta(pageMeta);
          if (pageMeta?.title && !tabTitle) setTitle(pageMeta.title);
        } catch {
          /* protected page */
        }
      }

      if (await aiAvailable()) {
        const ai = await getAiSettings();
        const context: PageContext = {
          title: pageMeta?.title || tabTitle,
          url: tabUrl,
          description: pageMeta?.description,
          text: pageMeta?.text,
        };
        if (!active) return;
        setAiBusy(true);
        const jobs: Promise<unknown>[] = [];
        if (ai.autoTag) jobs.push(suggestTags(context, tagNames).then((value) => active && setAiTags(value)).catch(() => {}));
        if (ai.autoSummarize) {
          jobs.push(
            summarize(context)
              .then((value) => active && setSummary((current) => current || value))
              .catch(() => {}),
          );
        }
        Promise.allSettled(jobs).finally(() => active && setAiBusy(false));
      }
    })();
    return () => {
      active = false;
    };
  }, [initialCollection]);

  async function save() {
    if (!url) return;
    if (!existing) {
      const cap = await canSaveBookmark();
      if (!cap.allowed) {
        setShowUpgrade(true);
        return;
      }
    }

    setBusy(true);
    try {
      const settings = await getSettings();
      let screenshotBlob: Blob | undefined;
      if (settings.enableAutoScreenshot) {
        const storageState = await storageRemaining();
        const roomy = storageState.unlimited || storageState.remaining === null || storageState.remaining > 0;
        if (roomy) {
          try {
            const response = await send<ScreenshotResult>({ type: 'CAPTURE_SCREENSHOT' });
            if (response?.dataUrl) screenshotBlob = dataUrlToBlob(response.dataUrl);
          } catch {
            /* save without preview */
          }
        }
      }

      const input = {
        url,
        title: title || url,
        note: note || undefined,
        summary: summary || undefined,
        content: meta?.text,
        description: meta?.description,
        tags,
        aiTags,
        collection: collection || undefined,
        cover: meta?.cover,
        favicon: meta?.favicon,
        domain: safeDomain(url),
        type: meta?.type ?? inferType(url),
        favorite,
        readingTime: meta?.readingTime,
        screenshotBlob,
      };

      try {
        const bookmark = await saveBookmark(input);
        const folderName = collections.find((item) => item.id === collection)?.name;
        toast(folderName ? `Saved to ${folderName}` : collection ? 'Saved to your vault' : 'Saved — filing with AI…', 'success');
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => [null] as any);
        browser.runtime.sendMessage({ type: 'KS_AUTOFILE', id: bookmark.id, tabId: tab?.id }).catch(() => {});
      } catch (error) {
        if ((error as { status?: number })?.status === 402) {
          setShowUpgrade(true);
          return;
        }
        await enqueueSave(input);
        toast('Offline — queued, will sync later', 'info');
      }

      setDone(true);
      onSaved?.();
      setTimeout(() => setDone(false), 1500);
    } finally {
      setBusy(false);
    }
  }

  const savable = /^https?:\/\//i.test(url);

  return (
    <div className="flex flex-col gap-2.5 p-3">
      {existing && (
        <div className="flex items-center gap-1.5 rounded-lg bg-brand/10 px-2.5 py-1.5 text-xs text-brand">
          <Icon name="check" size={13} /> Already in your vault — saving again creates a copy.
        </div>
      )}

      {meta?.cover && (
        <img src={meta.cover} alt="" className="h-28 w-full rounded-lg object-cover" onError={(event) => (event.currentTarget.style.display = 'none')} />
      )}

      <div className="flex items-start gap-2">
        <input className="input flex-1 font-medium" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" />
        <button className={`btn-outline px-2.5 ${favorite ? 'border-brand/50 text-brand' : ''}`} onClick={() => setFavorite((value) => !value)} title="Favorite">
          <Icon name={favorite ? 'star-fill' : 'star'} size={16} />
        </button>
      </div>

      <input className="input truncate text-xs text-ink-faint" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="URL" />

      {(summary || aiBusy) && (
        <div className="rounded-lg border border-line bg-surface-sunken p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-brand">
            <Icon name="sparkles" size={11} /> {aiBusy && !summary ? 'Summarizing…' : 'AI summary'}
          </div>
          {summary ? (
            <textarea className="w-full resize-none bg-transparent text-xs text-ink-soft outline-none" rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} />
          ) : (
            <div className="skeleton h-3 w-3/4 rounded" />
          )}
        </div>
      )}

      <TagInput tags={tags} onChange={setTags} suggestions={allTags} aiTags={aiTags} placeholder="Add tags…" />

      {creatingFolder ? (
        <div className="flex items-center gap-1.5">
          <input
            className="input flex-1"
            autoFocus
            placeholder="New folder name"
            value={newFolder}
            onChange={(event) => setNewFolder(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') createFolder();
              else if (event.key === 'Escape') {
                setCreatingFolder(false);
                setNewFolder('');
              }
            }}
          />
          <button className="btn-primary px-2.5" onClick={createFolder} title="Create folder"><Icon name="check" size={16} /></button>
          <button className="btn-ghost px-2" onClick={() => { setCreatingFolder(false); setNewFolder(''); }} title="Cancel"><Icon name="close" size={16} /></button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select className="input flex-1" value={collection} onChange={(event) => setCollection(event.target.value)}>
            <option value="">No collection</option>
            {collections.map((item) => (
              <option key={item.id} value={item.id}>{item.icon ? `${item.icon} ` : ''}{item.name}</option>
            ))}
          </select>
          <button className="btn-outline px-2.5" onClick={() => setCreatingFolder(true)} title="New folder"><Icon name="plus" size={16} /></button>
        </div>
      )}

      <input className="input text-sm" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note (optional)" />

      <button className="btn-primary" onClick={save} disabled={busy || !savable}>
        {done ? <><Icon name="check" size={16} /> Saved</> : busy ? 'Saving…' : <><Icon name="bookmark" size={16} fill /> Save page</>}
      </button>
      {!savable && url !== '' && <p className="text-center text-xs text-ink-faint">This page can’t be saved (not a web URL).</p>}
      {showUpgrade && <UpgradeDialog reason="bookmarks" onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
