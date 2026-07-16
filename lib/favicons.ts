// Persistent favicon cache.
//
// Catalog tiles and saved bookmarks carry remote favicon URLs (the app catalog
// uses Google's favicon service, saved pages use faviconFor()/the site's own).
// Rendering those as plain <img src> re-fetches from the network on every Home
// open — visible pop-in, a burst of requests per open, and broken icons when
// offline. Instead we store each favicon as a data URI in IndexedDB the first
// time it loads, then serve it from cache forever: zero per-open network, and
// icons render fully offline.
//
// (Statically bundling the catalog's Google-served icons at build time isn't
// possible here — the build egress policy denies Google — so we cache at
// runtime and pre-warm the whole catalog in the background on install. Same
// outcome as bundling, and it covers user-added custom favicons too. The
// extension's <all_urls> host permission means fetch() reads cross-origin
// favicon bytes without CORS restrictions.)
//
// Kept dependency-free (raw IndexedDB, no Dexie) so it adds nothing to the
// new-tab bundle beyond this file.

const DB_NAME = 'keepsake_icons';
const STORE = 'icons';
const MAX_BYTES = 256 * 1024; // a favicon over 256KB is almost certainly not one

interface IconRow {
  url: string;
  data: string; // data: URI
  ts: number;
}

// Entries older than this are dropped on first open per context — without ANY
// eviction the cache grew forever (each row is a base64 data URI, up to
// ~340KB), plus the same again in the per-tab memory mirror. Anything still in
// use is simply re-fetched once and re-cached with a fresh timestamp.
const MAX_AGE_MS = 90 * 24 * 3600_000;

let dbp: Promise<IDBDatabase> | null = null;
let pruned = false;
function idb(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'url' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbp = null; // let a later call retry if the open failed
    throw e;
  });
  dbp.then((db) => {
    if (pruned) return;
    pruned = true;
    try {
      const cutoff = Date.now() - MAX_AGE_MS;
      const tx = db.transaction(STORE, 'readwrite');
      const cur = tx.objectStore(STORE).openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        if (((c.value as IconRow).ts ?? 0) < cutoff) c.delete();
        c.continue();
      };
    } catch {
      /* pruning is best-effort */
    }
  }).catch(() => {});
  return dbp;
}

async function idbGet(url: string): Promise<string | undefined> {
  const db = await idb();
  return new Promise((resolve) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(url);
    r.onsuccess = () => resolve((r.result as IconRow | undefined)?.data);
    r.onerror = () => resolve(undefined);
  });
}

async function idbPut(url: string, data: string): Promise<void> {
  const db = await idb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ url, data, ts: Date.now() } satisfies IconRow);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

// Per-context in-memory mirror so a warmed icon resolves synchronously at render
// time (no async flash), plus in-flight dedupe so N tiles sharing one URL fetch
// it once.
const mem = new Map<string, string>();
const inflight = new Map<string, Promise<string | undefined>>();

// Only http(s) URLs are worth caching. data: URIs are already inline; the
// bookmark:// glyph / letter-tile fallbacks have no src at all.
export function isCacheableIcon(src?: string): src is string {
  return !!src && /^https?:\/\//i.test(src);
}

// Synchronous lookup for the current render. Undefined = not warmed yet.
export function cachedIcon(src?: string): string | undefined {
  return isCacheableIcon(src) ? mem.get(src) : undefined;
}

// Resolve a favicon to a cached data URI: memory → IndexedDB → network fetch
// (then persist). Returns undefined when it can't be cached (offline on a
// never-seen icon, blocked/broken host, non-image, too large) — the caller then
// falls back to the plain <img src> and its own onError handling.
export async function ensureIcon(src?: string): Promise<string | undefined> {
  if (!isCacheableIcon(src)) return undefined;
  const warm = mem.get(src);
  if (warm) return warm;
  const pending = inflight.get(src);
  if (pending) return pending;

  const p = (async (): Promise<string | undefined> => {
    try {
      const hit = await idbGet(src);
      if (hit) {
        mem.set(src, hit);
        return hit;
      }
      const res = await fetch(src, { cache: 'force-cache' });
      if (!res.ok) return undefined;
      const blob = await res.blob();
      if (!blob.size || blob.size > MAX_BYTES || !blob.type.startsWith('image/')) return undefined;
      const data = await blobToDataUrl(blob);
      mem.set(src, data);
      await idbPut(src, data);
      return data;
    } catch {
      return undefined; // offline / blocked — plain <img> takes over
    } finally {
      inflight.delete(src);
    }
  })();
  inflight.set(src, p);
  return p;
}

// Warm a batch of URLs with bounded concurrency (e.g. the whole app catalog on
// install, so even the first Home open is network-free).
export async function warmIcons(urls: (string | undefined)[], concurrency = 6): Promise<void> {
  const list = [...new Set(urls.filter(isCacheableIcon))];
  let i = 0;
  const worker = async () => {
    while (i < list.length) await ensureIcon(list[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
}

// arrayBuffer + btoa (not FileReader): FileReader isn't exposed in a MV3
// service worker, and the catalog pre-warm runs there — this works in both the
// worker and page contexts. Favicons are small (< MAX_BYTES), so the byte loop
// is cheap and avoids the stack blow-up of String.fromCharCode(...bigArray).
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}
