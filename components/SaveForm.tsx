import { useEffect, useRef, useState } from 'react';
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
import { type Collection } from '@/lib/types';
import { type PageMeta } from '@/lib/metadata';
import { TagInput } from './TagInput';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { UpgradeDialog } from './UpgradeDialog';

// Reads the active tab, enriches it (metadata + optional AI tags/summary),
// lets the user tweak, and saves to PocketBase — queueing offline if needed.
export function SaveForm({ onSaved }: { onSaved?: () => void }) {
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

  const folderBusyRef = useRef(false);
  async function createFolder() {
    const name = newFolder.trim();
    if (!name || folderBusyRef.current) return; // double-Enter → duplicate folders
    folderBusyRef.current = true;
    try {
      const c = await createCollection({ name });
      setCollections((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
      setCollection(c.id);
      setNewFolder('');
      setCreatingFolder(false);
      toast(`Folder “${name}” created`, 'success');
    } catch {
      toast('Could not create folder', 'error');
    } finally {
      folderBusyRef.current = false;
    }
  }

  useEffect(() => {
    (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const tabUrl = tab?.url ?? '';
      const tabTitle = tab?.title ?? '';
      setTitle(tabTitle);
      setUrl(tabUrl);

      let tagNames: string[] = [];
      let cols: Collection[] = [];
      try {
        cols = await listCollections();
        setCollections(cols);
        tagNames = (await getAllTags()).map((t) => t.tag);
        setAllTags(tagNames);
      } catch {
        /* not logged in */
      }
      const s = await getSettings();
      if (s.defaultCollection) setCollection(s.defaultCollection);

      // Already saved? Surface it so we don't create duplicates.
      try {
        const found = tabUrl ? await findByUrl(tabUrl) : null;
        if (found) setExisting(true);
      } catch {
        /* ignore */
      }

      // Enrich with page metadata (og:image, description, reading time, excerpt).
      let pageMeta: PageMeta | null = null;
      if (s.enableMetadata && tab?.id) {
        try {
          const res = await send<MetaResult>({ type: 'EXTRACT_META', tabId: tab.id });
          pageMeta = res?.meta ?? null;
          setMeta(pageMeta);
          if (pageMeta?.title && !tabTitle) setTitle(pageMeta.title);
        } catch {
          /* page may block injection */
        }
      }

      // AI enrichment — best effort, non-blocking on the save button.
      if (await aiAvailable()) {
        const ai = await getAiSettings();
        const ctx: PageContext = {
          title: pageMeta?.title || tabTitle,
          url: tabUrl,
          description: pageMeta?.description,
          text: pageMeta?.text,
        };
        setAiBusy(true);
        const jobs: Promise<void>[] = [];
        if (ai.autoTag) {
          jobs.push(
            suggestTags(ctx, tagNames)
              .then(setAiTags)
              .catch(() => {}),
          );
        }
        if (ai.autoSummarize) {
          jobs.push(
            summarize(ctx)
              .then((s) => setSummary((cur) => cur || s))
              .catch(() => {}),
          );
        }
        // Collection suggestion removed: filing is owned by the auto-file
        // pipeline (KS_AUTOFILE after save) — two competing filers would fight.
        Promise.allSettled(jobs).finally(() => setAiBusy(false));
      }
    })();
  }, []);

  async function save() {
    // Gate BEFORE the awaited cap check — a double-click in that window saved
    // the page twice (two bookmarks, two screenshots).
    if (busy) return;
    setBusy(true);
    if (!url) {
      setBusy(false);
      return;
    }
    // Cloud bookmark cap (Free) — a guardrail; PocketBase is the real enforcer.
    // Re-saving an already-existing bookmark isn't blocked (not a new one).
    if (!existing) {
      const cap = await canSaveBookmark().catch(() => ({ allowed: true }));
      if (!cap.allowed) {
        setBusy(false);
        setShowUpgrade(true);
        return;
      }
    }
    try {
      const settings = await getSettings();
      let screenshotBlob: Blob | undefined;
      if (settings.enableAutoScreenshot) {
        // Storage guardrail: skip only the preview image when tight on the
        // estimated cloud storage cap — the save itself always proceeds.
        const storageState = await storageRemaining();
        const roomy = storageState.unlimited || storageState.remaining === null || storageState.remaining > 0;
        if (roomy) {
          try {
            const res = await send<ScreenshotResult>({ type: 'CAPTURE_SCREENSHOT' });
            if (res?.dataUrl) screenshotBlob = dataUrlToBlob(res.dataUrl);
          } catch {
            /* capture failed, save without preview */
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
        const bm = await saveBookmark(input);
        toast(collection ? 'Saved to your vault' : 'Saved — filing with AI…', 'success');
        // AI pass runs in the background so it survives the popup closing.
        // A user-picked collection is respected; otherwise AI files it.
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => [null] as any);
        browser.runtime.sendMessage({ type: 'KS_AUTOFILE', id: bm.id, tabId: tab?.id }).catch(() => {});
      } catch (e) {
        // A 402 is the server's authoritative plan-cap rejection (permanent) —
        // show the paywall rather than queuing it offline to retry forever.
        if ((e as { status?: number })?.status === 402) {
          setShowUpgrade(true);
          return; // finally still resets busy; skip the "saved" UI below
        }
        // Offline / server down — keep it so nothing is lost.
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
        <img
          src={meta.cover}
          alt=""
          className="h-28 w-full rounded-lg object-cover"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      )}

      <div className="flex items-start gap-2">
        <input
          className="input flex-1 font-medium"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
        />
        <button
          className={`btn-outline px-2.5 ${favorite ? 'border-brand/50 text-brand' : ''}`}
          onClick={() => setFavorite((f) => !f)}
          title="Favorite"
        >
          <Icon name={favorite ? 'star-fill' : 'star'} size={16} />
        </button>
      </div>

      <input
        className="input truncate text-xs text-ink-faint"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL"
      />

      {(summary || aiBusy) && (
        <div className="rounded-lg border border-line bg-surface-sunken p-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-brand">
            <Icon name="sparkles" size={11} /> {aiBusy && !summary ? 'Summarizing…' : 'AI summary'}
          </div>
          {summary ? (
            <textarea
              className="w-full resize-none bg-transparent text-xs text-ink-soft outline-none"
              rows={2}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          ) : (
            <div className="skeleton h-3 w-3/4 rounded" />
          )}
        </div>
      )}

      <TagInput
        tags={tags}
        onChange={setTags}
        suggestions={allTags}
        aiTags={aiTags}
        placeholder="Add tags…"
      />

      {creatingFolder ? (
        <div className="flex items-center gap-1.5">
          <input
            className="input flex-1"
            autoFocus
            placeholder="New folder name"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createFolder();
              else if (e.key === 'Escape') {
                setCreatingFolder(false);
                setNewFolder('');
              }
            }}
          />
          <button className="btn-primary px-2.5" onClick={createFolder} title="Create folder">
            <Icon name="check" size={16} />
          </button>
          <button
            className="btn-ghost px-2"
            onClick={() => {
              setCreatingFolder(false);
              setNewFolder('');
            }}
            title="Cancel"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            className="input flex-1"
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">No collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ''}
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="btn-outline px-2.5"
            onClick={() => setCreatingFolder(true)}
            title="New folder"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      )}

      <input
        className="input text-sm"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note (optional)"
      />

      <button className="btn-primary" onClick={save} disabled={busy || !savable}>
        {done ? (
          <>
            <Icon name="check" size={16} /> Saved
          </>
        ) : busy ? (
          'Saving…'
        ) : (
          <>
            <Icon name="bookmark" size={16} fill /> Save page
          </>
        )}
      </button>
      {!savable && url !== '' && (
        <p className="text-center text-xs text-ink-faint">This page can’t be saved (not a web URL).</p>
      )}
      {showUpgrade && <UpgradeDialog reason="bookmarks" onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
