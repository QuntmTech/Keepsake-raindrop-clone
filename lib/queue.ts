import { storage } from 'wxt/utils/storage';
import { saveBookmark, findByUrl, type SaveBookmarkInput } from './bookmarks';
import { genId } from './util';

// Offline save queue. If a save fails (offline, server down), we stash the
// request in chrome.storage and retry later — on reconnect or next launch.
// Screenshots aren't queued (Blobs don't serialize cleanly); a queued save
// still keeps url/title/tags/collection so nothing the user typed is lost.
//
// Concurrency model: enqueue happens in UI contexts (popup/newtab) while the
// flush runs in the background SW, and multiple flush triggers exist (queue
// alarm + `online` event + explicit FLUSH_QUEUE message). Two Web Locks make
// that safe across contexts:
//   - 'ks-queue-store' guards every read-modify-write of the stored array,
//     held only for the brief storage round-trip — so a save enqueued while a
//     flush is mid-network can never be clobbered by the flush's final write.
//   - 'ks-queue-flush' (ifAvailable) collapses concurrent flush triggers into
//     one — the losers return immediately instead of double-saving every item.

type QueuedSave = Omit<SaveBookmarkInput, 'screenshotBlob'> & {
  queuedAt: number;
  qid?: string; // per-item identity so a flush removes exactly what it processed
  attempts?: number;
};

const queueStore = storage.defineItem<QueuedSave[]>('local:save_queue', {
  fallback: [],
});

// Give up on an item after this many failed flush passes — bounds queue
// poisoning by a permanently-rejected save we didn't classify as permanent.
const MAX_ATTEMPTS = 8;

type LockCb<T> = (lock: unknown) => Promise<T>;
async function withLock<T>(name: string, cb: LockCb<T>, ifAvailable = false): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request: (n: string, o: object, cb: LockCb<T>) => Promise<T> } } })
    .navigator?.locks;
  if (!locks?.request) return cb({}); // ancient/odd context — degrade to unguarded
  return locks.request(name, { ifAvailable }, cb);
}

export async function enqueueSave(input: SaveBookmarkInput): Promise<void> {
  const { screenshotBlob, ...rest } = input;
  void screenshotBlob;
  await withLock('ks-queue-store', async () => {
    const queue = await queueStore.getValue();
    queue.push({ ...rest, queuedAt: Date.now(), qid: genId(), attempts: 0 });
    await queueStore.setValue(queue);
  });
}

export async function queueLength(): Promise<number> {
  return (await queueStore.getValue()).length;
}

// Attempt to flush everything. Items that still fail are kept for next time.
// Returns how many saves succeeded.
export async function flushQueue(): Promise<number> {
  return withLock(
    'ks-queue-flush',
    async (lock) => {
      if (!lock) return 0; // another flush is already running — let it finish
      return doFlush();
    },
    /* ifAvailable */ true,
  );
}

async function doFlush(): Promise<number> {
  // Snapshot the queue under the store lock, assigning qids to any legacy
  // items persisted before this scheme (so removal below can identify them).
  const snapshot = await withLock('ks-queue-store', async () => {
    const queue = await queueStore.getValue();
    let migrated = false;
    for (const item of queue) {
      if (!item.qid) {
        item.qid = genId();
        migrated = true;
      }
    }
    if (migrated) await queueStore.setValue(queue);
    return queue;
  });
  if (snapshot.length === 0) return 0;

  const remove = new Set<string>(); // qids to delete (saved, duplicate, or permanently rejected)
  const failed = new Set<string>(); // qids that failed transiently (bump attempts)
  let saved = 0;
  let dropped = 0;
  for (const item of snapshot) {
    const { queuedAt, qid, attempts, ...input } = item;
    void queuedAt;
    try {
      // A previous flush may have died between the server committing the create
      // and us recording it (SW killed, request timeout after commit) — re-check
      // by URL so a retry can't file the same page twice.
      const existing = await findByUrl(input.url).catch(() => null);
      if (!existing) await saveBookmark(input);
      saved++;
      remove.add(qid!);
    } catch (e) {
      const status = (e as { status?: number })?.status ?? 0;
      // Permanent 4xx rejections (402 over plan cap, 400 invalid, …) can never
      // succeed on retry — drop them instead of poisoning the queue forever.
      // 401/403 (expired/derailed session — succeeds after re-login), 408
      // (timeout) and 429 (rate limit) are recoverable: keep those queued,
      // bounded by MAX_ATTEMPTS.
      const recoverable = status === 0 || status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
      if (!recoverable || (attempts ?? 0) + 1 >= MAX_ATTEMPTS) {
        dropped++;
        remove.add(qid!);
      } else {
        failed.add(qid!);
      }
    }
  }

  // Re-read the live queue and remove only what this flush actually settled —
  // items enqueued while we were saving stay untouched for the next pass.
  await withLock('ks-queue-store', async () => {
    const queue = await queueStore.getValue();
    const next = queue
      .filter((i) => !i.qid || !remove.has(i.qid))
      .map((i) => (i.qid && failed.has(i.qid) ? { ...i, attempts: (i.attempts ?? 0) + 1 } : i));
    await queueStore.setValue(next);
  });
  if (dropped) console.warn(`[keepsake] dropped ${dropped} queued save(s) permanently rejected by the server (e.g. over plan cap)`);
  return saved;
}

export function watchQueue(cb: (n: number) => void): () => void {
  return queueStore.watch((v) => cb((v ?? []).length));
}
