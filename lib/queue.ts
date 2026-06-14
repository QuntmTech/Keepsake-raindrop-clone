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
  for (const item of queue) {
    try {
      const { queuedAt, ...input } = item;
      void queuedAt;
      await saveBookmark(input);
      saved++;
    } catch {
      remaining.push(item);
    }
  }
  await queueStore.setValue(remaining);
  return saved;
}

export function watchQueue(cb: (n: number) => void): () => void {
  return queueStore.watch((v) => cb((v ?? []).length));
}
