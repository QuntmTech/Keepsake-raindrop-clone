import { storage } from 'wxt/utils/storage';
import { type Bookmark, type Collection } from './types';
import { HOSTED } from './config';

// Instant-load cache. We persist the last-seen "all bookmarks" view + collections
// so the popup/dashboard paint immediately on open, then refresh from the server
// in the background (stale-while-revalidate). Keyed by user id so accounts never
// see each other's cached data.
export interface VaultSnapshot {
  uid: string;
  bookmarks: Bookmark[];
  collections: Collection[];
  counts: Record<string, number>;
  ts: number;
}

const item = storage.defineItem<VaultSnapshot | null>('local:vault_snapshot', { fallback: null });

export async function readSnapshot(uid: string | null): Promise<VaultSnapshot | null> {
  if (!HOSTED || !uid) return null; // local mode is already instant
  const s = await item.getValue();
  return s && s.uid === uid ? s : null;
}

// The snapshot exists to paint tiles/rows instantly — it does NOT need the
// heavy fields. `content` alone can be the full text of every saved page;
// serializing that through chrome.storage on every new-tab open made Home
// slower the bigger a vault grew. Strip to paint-only fields, cap the count,
// and debounce: Home calls this several times per open (bookmarks, collections
// and counts settle separately) — one write 400ms after the last call wins.
const SNAPSHOT_MAX = 300;
function slimBookmark(b: Bookmark): Bookmark {
  const { content, summary, note, aiTags, ...rest } = b;
  return rest as Bookmark;
}

let pending: VaultSnapshot | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function writeSnapshot(s: Omit<VaultSnapshot, 'ts'>): Promise<void> {
  if (!HOSTED || !s.uid) return;
  pending = { ...s, ts: Date.now(), bookmarks: s.bookmarks.slice(0, SNAPSHOT_MAX).map(slimBookmark) };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const snap = pending;
    pending = null;
    timer = null;
    if (snap) item.setValue(snap).catch(() => {});
  }, 400);
}

export async function clearSnapshot(): Promise<void> {
  await item.setValue(null);
}
