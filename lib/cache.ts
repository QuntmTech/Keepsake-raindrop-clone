import { storage } from 'wxt/utils/storage';
import { type Bookmark, type Collection } from './types';
import { HOSTED } from './config';

// Instant-load cache. We persist the last-seen Home-ready bookmarks + collections
// so UI surfaces paint immediately, then refresh from the server in the background.
export interface VaultSnapshot {
  uid: string;
  bookmarks: Bookmark[];
  collections: Collection[];
  counts: Record<string, number>;
  ts: number;
}

const item = storage.defineItem<VaultSnapshot | null>('local:vault_snapshot', { fallback: null });

// Startup-only fast path. Logout clears this snapshot, and hosted auth is mirrored
// locally, so Home can safely paint the last signed-in user's shell without first
// constructing PocketBase. The normal refresh remains authoritative.
export async function readLastSnapshot(): Promise<VaultSnapshot | null> {
  if (!HOSTED) return null;
  return item.getValue();
}

export async function readSnapshot(uid: string | null): Promise<VaultSnapshot | null> {
  if (!HOSTED || !uid) return null; // local mode is already instant
  const snapshot = await readLastSnapshot();
  return snapshot && snapshot.uid === uid ? snapshot : null;
}

// The snapshot exists to paint tiles/rows instantly — it does NOT need the
// heavy fields. `content` alone can be the full text of every saved page;
// serializing that through chrome.storage on every new-tab open made Home
// slower the bigger a vault grew. Strip to paint-only fields, cap the count,
// and debounce: Home calls this several times per open (bookmarks, collections
// and counts settle separately) — one write 400ms after the last call wins.
const SNAPSHOT_MAX = 300;
function slimBookmark(bookmark: Bookmark): Bookmark {
  const { content, summary, note, aiTags, ...rest } = bookmark;
  return rest as Bookmark;
}

let pending: VaultSnapshot | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function writeSnapshot(snapshot: Omit<VaultSnapshot, 'ts'>): Promise<void> {
  if (!HOSTED || !snapshot.uid) return;
  pending = {
    ...snapshot,
    ts: Date.now(),
    bookmarks: snapshot.bookmarks.slice(0, SNAPSHOT_MAX).map(slimBookmark),
  };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const next = pending;
    pending = null;
    timer = null;
    if (next) item.setValue(next).catch(() => {});
  }, 400);
}

export async function clearSnapshot(): Promise<void> {
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await item.setValue(null);
}
