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

// User-triggered saves should acknowledge immediately. This schedules the same
// durable queue for the earliest MV3-safe alarm window instead of making the
// click wait for extraction, embeddings, or an LLM response.
export function scheduleQueueSoon(): void {
  browser.alarms.create(QUEUE_ALARM, { periodInMinutes: 1, delayInMinutes: 0.5 });
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

export async function processQueueTick(): Promise<void> {
  const backoff = await getBackoff();
  if (Date.now() < backoff.until) return;

  const hasLlm = await llmAvailable();
  // Work = links missing an embedding, or (when an LLM is usable) never filed.
  // Launcher tiles (homeOnly/pinned) are excluded — they're not library
  // content and must never be re-filed or Inboxed.
  const pending = await db.saves
    .filter(
      (s) =>
        s.type === 'link' &&
        !s.organization.homeOnly &&
        !s.organization.pinned &&
        (!s.ai.embedding || s.ai.embedding.length === 0 || (hasLlm && s.ai.filedBy == null)),
    )
    .limit(BATCH_PER_TICK)
    .toArray();
  if (!pending.length) return;

  let providerFailed = false;
  for (const s of pending) {
    const before = await db.saves.get(s.id);
    const res = await autofileSave(s.id).catch(() => null);
    // If an LLM is configured but the item still isn't filed, the provider is
    // erroring (bad key / rate limit) — back off instead of burning the queue.
    if (hasLlm && (!res || res.status === 'unprocessed') && before?.ai.filedBy == null) {
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
