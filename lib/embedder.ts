// Client for the local embedding engine. The model (all-MiniLM-L6-v2, 384-dim,
// ~25MB, cached by the browser after first download) runs inside the OFFSCREEN
// DOCUMENT — the MV3 service worker dies too fast to hold a model in memory.
// This module is called from the background worker; it ensures the offscreen
// document exists and messages it for embed / similarity jobs.
//
// Everything here is 100% local: no text ever leaves the device.

// THE single offscreen-document creator for the whole extension (recorder,
// embedder, watch fetcher all share one document — Chrome allows only one).
// In-flight memoization + tolerating the "already exists" error close the
// check-then-create race between concurrent callers.
let creating: Promise<void> | null = null;

export async function ensureOffscreen(): Promise<void> {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await (browser.runtime as any).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length > 0) return;
    try {
      await (browser as any).offscreen.createDocument({
        url: browser.runtime.getURL('/offscreen.html'),
        reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'WORKERS'],
        justification:
          'Runs the local embedding model for auto-filing and Ambient Recall, screen recording so captures survive popup close, and page fetches for watched bookmarks',
      });
    } catch (e) {
      // A concurrent caller (other module / other SW event) won the race.
      if (!String(e).includes('single offscreen')) throw e;
    }
  })();
  try {
    await creating;
  } finally {
    creating = null;
  }
}

async function callOffscreen<T>(msg: Record<string, unknown>, timeoutMs = 120_000): Promise<T> {
  await ensureOffscreen();
  const resp = (await Promise.race([
    browser.runtime.sendMessage({ target: 'ks-offscreen', ...msg }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('offscreen timeout')), timeoutMs)),
  ])) as { ok: boolean; error?: string } & T;
  if (!resp?.ok) throw new Error(resp?.error || 'offscreen call failed');
  return resp;
}

// Embed one or more texts → unit-normalized 384-dim vectors. The first call
// after browser start downloads/loads the model, so allow a generous timeout.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const resp = await callOffscreen<{ vectors: number[][] }>({ type: 'OFFSCREEN_EMBED', texts });
  return resp.vectors;
}

// Rank the library against a query text — computed inside the offscreen doc,
// which reads embeddings straight from IndexedDB (same origin). Returns save
// ids with cosine similarity, best first, above `threshold`.
export async function semanticMatch(
  text: string,
  opts: { threshold?: number; limit?: number; excludeCanonical?: string } = {},
): Promise<Array<{ id: string; score: number }>> {
  const resp = await callOffscreen<{ matches: Array<{ id: string; score: number }> }>({
    type: 'OFFSCREEN_MATCH',
    text,
    threshold: opts.threshold ?? 0.75,
    limit: opts.limit ?? 5,
    excludeCanonical: opts.excludeCanonical,
  });
  return resp.matches;
}
