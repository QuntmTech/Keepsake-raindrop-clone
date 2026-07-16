import { getAiSettings } from './ai';
import { autofileSave } from './autofile';
import { llmAvailable } from './llm';
import { db } from './save';

// Batch AI queue (Phase 1.3). A chrome.alarms tick sweeps saves that still
// need work — no embedding yet, or never filed — and processes a small batch
// per minute with exponential backoff on provider failures. This powers bulk
// imports and recovers saves made while offline or before a key was added.

export const QUEUE_ALARM = 'ks-ai-queue';
const BATCH_PER_TICK = 4;
const BACKOFF_KEY = 'queue_backoff';

export function scheduleQueue(): void {
  browser.alarms.create(QUEUE_ALARM, { periodInMinutes: 1, delayInMinutes: 1 });
}

interface Backoff {
  until: number;
  step: number; // minutes; doubles per consecutive failure round, caps at 60
}

async function getBackoff(): Promise<Backoff> {
  const row = await db.meta.get(BACKOFF_KEY);
  return (row?.value as Backoff) ?? { until: 0, step: 0 };
}

async function setBackoff(b: Backoff): Promise<void> {
  await db.meta.put({ key: BACKOFF_KEY, value: b });
}

// Give up on an item after this many failed passes — a single reliably-failing
// save (e.g. an unparseable filing decision) sat head-of-line otherwise,
// retried every backoff round forever while everything queued behind it (even
// items only needing embeddings) never ran.
const MAX_ITEM_ATTEMPTS = 5;

// One tick at a time: autofileSave can exceed the 1-minute alarm period (LLM
// call + a cold embedding-model download), and an overlapping tick re-selected
// the same still-unfiled saves — double provider spend and duplicate
// LLM-created collections.
let ticking = false;

export async function processQueueTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await tick();
  } finally {
    ticking = false;
  }
}

async function tick(): Promise<void> {
  const backoff = await getBackoff();
  if (Date.now() < backoff.until) return;

  const hasLlm = await llmAvailable();
  // "Needs filing" must mirror the predicate autofileSave ACTUALLY files under
  // (enabled && autoFile && key). Selecting on hasLlm alone wedged the queue
  // for key-configured users with auto-filing OFF: the item was re-selected
  // forever, read as a provider failure, and its 60-min backoff starved every
  // other save of embeddings.
  const ai = await getAiSettings();
  const canFile = hasLlm && ai.autoFile;
  // Work = links missing an embedding, or (when auto-filing is active) never
  // filed. Launcher tiles (homeOnly/pinned) are excluded — they're not library
  // content and must never be re-filed or Inboxed.
  const pending = await db.saves
    .filter(
      (s) =>
        s.type === 'link' &&
        !s.organization.homeOnly &&
        !s.organization.pinned &&
        (s.ai.queueAttempts ?? 0) < MAX_ITEM_ATTEMPTS &&
        (!s.ai.embedding || s.ai.embedding.length === 0 || (canFile && s.ai.filedBy == null)),
    )
    .limit(BATCH_PER_TICK)
    .toArray();
  if (!pending.length) return;

  let providerFailed = false;
  for (const s of pending) {
    const before = await db.saves.get(s.id);
    const res = await autofileSave(s.id).catch(() => null);
    // If auto-filing is active but the item still isn't filed, the provider is
    // erroring (bad key / rate limit) — back off instead of burning the queue,
    // and count the attempt so one poisoned item can't block the line forever.
    if (canFile && (!res || res.status === 'unprocessed') && before?.ai.filedBy == null) {
      await db.saves
        .update(s.id, { 'ai.queueAttempts': (before?.ai.queueAttempts ?? 0) + 1 } as never)
        .catch(() => {});
      providerFailed = true;
      break;
    }
  }

  if (providerFailed) {
    const step = Math.min(backoff.step ? backoff.step * 2 : 5, 60);
    await setBackoff({ until: Date.now() + step * 60_000, step });
  } else if (backoff.step) {
    await setBackoff({ until: 0, step: 0 });
  }
}
