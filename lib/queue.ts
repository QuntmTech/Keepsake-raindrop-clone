import { storage } from 'wxt/utils/storage';
import { findByUrl, saveBookmark, updateBookmark, type SaveBookmarkInput } from './bookmarks';

// Offline save queue. If a save fails transiently (offline, timeout, server down),
// stash the request and retry later. Queue writes are serialized because several
// extension surfaces may save at once while the MV3 worker is awake.
type QueuedSave = Omit<SaveBookmarkInput, 'screenshotBlob'> & { queuedAt: number };

const queueStore = storage.defineItem<QueuedSave[]>('local:save_queue', { fallback: [] });
let queueMutation: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(work: () => Promise<T>): Promise<T> {
  const next = queueMutation.then(work, work);
  queueMutation = next.catch(() => undefined);
  return next;
}

function sameDestination(a: QueuedSave, b: Omit<SaveBookmarkInput, 'screenshotBlob'>): boolean {
  return a.url === b.url && (a.collection ?? '') === (b.collection ?? '');
}

export async function enqueueSave(input: SaveBookmarkInput): Promise<void> {
  const { screenshotBlob, ...rest } = input;
  void screenshotBlob;
  await withQueueLock(async () => {
    const queue = await queueStore.getValue();
    const existing = queue.findIndex((item) => sameDestination(item, rest));
    const next = { ...rest, queuedAt: Date.now() };
    if (existing >= 0) queue[existing] = next;
    else queue.push(next);
    await queueStore.setValue(queue.slice(-100));
  });
}

export async function queueLength(): Promise<number> {
  return (await queueStore.getValue()).length;
}

// Attempt to flush everything. A prior timed-out create may actually have landed
// server-side, so check by URL before replaying it. This makes reconnect retries
// idempotent even before the backend gains client_uuid support.
export async function flushQueue(): Promise<number> {
  return withQueueLock(async () => {
    const queue = await queueStore.getValue();
    if (queue.length === 0) return 0;

    const remaining: QueuedSave[] = [];
    let saved = 0;
    let dropped = 0;
    for (const item of queue) {
      try {
        const { queuedAt, ...input } = item;
        void queuedAt;
        const existing = await findByUrl(input.url).catch(() => null);
        if (existing) {
          const destination = input.collection ?? '';
          if ((existing.collection ?? '') !== destination) {
            await updateBookmark(existing.id, { collection: destination });
          }
          saved++;
          continue;
        }
        await saveBookmark(input);
        saved++;
      } catch (error) {
        const status = (error as { status?: number })?.status ?? 0;
        // Permanent client failures can never recover. Timeout/network/429/5xx
        // remain queued; a later URL check prevents duplicate ambiguous creates.
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) dropped++;
        else remaining.push(item);
      }
    }
    await queueStore.setValue(remaining);
    if (dropped) console.warn(`[keepsake] dropped ${dropped} queued save(s) permanently rejected by the server`);
    return saved;
  });
}

export function watchQueue(cb: (n: number) => void): () => void {
  return queueStore.watch((value) => cb((value ?? []).length));
}
