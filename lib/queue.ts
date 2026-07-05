import { storage } from 'wxt/utils/storage';
import { saveBookmark, type SaveBookmarkInput } from './bookmarks';

// Offline save queue. If a save fails (offline, server down), we stash the
// request in chrome.storage and retry later — on reconnect or next launch.
// Screenshots aren't queued (Blobs don't serialize cleanly); a queued save
// still keeps url/title/tags/collection so nothing the user typed is lost.

type QueuedSave = Omit<SaveBookmarkInput, 'screenshotBlob'> & { queuedAt: number };

const queueStore = storage.defineItem<QueuedSave[]>('local:save_queue', {
  fallback: [],
});

export async function enqueueSave(input: SaveBookmarkInput): Promise<void> {
  const { screenshotBlob, ...rest } = input;
  void screenshotBlob;
  const queue = await queueStore.getValue();
  queue.push({ ...rest, queuedAt: Date.now() });
  await queueStore.setValue(queue);
}

export async function queueLength(): Promise<number> {
  return (await queueStore.getValue()).length;
}

// Attempt to flush everything. Items that still fail are kept for next time.
// Returns how many saves succeeded.
export async function flushQueue(): Promise<number> {
  const queue = await queueStore.getValue();
  if (queue.length === 0) return 0;

  const remaining: QueuedSave[] = [];
  let saved = 0;
  let dropped = 0;
  for (const item of queue) {
    try {
      const { queuedAt, ...input } = item;
      void queuedAt;
      await saveBookmark(input);
      saved++;
    } catch (e) {
      const status = (e as { status?: number })?.status ?? 0;
      // A permanent 4xx rejection (e.g. 402 over the plan cap, 403 forbidden,
      // 400 invalid) can NEVER succeed on retry — drop it instead of poisoning
      // the queue forever. Transient failures (offline / 5xx / 429) stay queued.
      if (status >= 400 && status < 500 && status !== 429) dropped++;
      else remaining.push(item);
    }
  }
  await queueStore.setValue(remaining);
  if (dropped) console.warn(`[keepsake] dropped ${dropped} queued save(s) permanently rejected by the server (e.g. over plan cap)`);
  return saved;
}

export function watchQueue(cb: (n: number) => void): () => void {
  return queueStore.watch((v) => cb((v ?? []).length));
}
