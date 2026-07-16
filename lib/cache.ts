import { storage } from 'wxt/utils/storage';
import { type Bookmark, type Collection } from './types';
import { HOSTED } from './config';

// Instant-load cache. We persist the last-seen view + collections so surfaces
// paint immediately on open, then refresh from the server in the background
// (stale-while-revalidate). Keyed by user id so accounts never see each
// other's cached data.
//
// TWO scopes, two storage keys: Home's working set is launcher rows only
// (pinned/homeOnly, light projection), while the popup/dashboard cache the
// library view. Sharing one key let every new-tab open overwrite the library
// snapshot with a handful of tiles — the popup then instant-painted a dozen
// launcher icons as the user's "whole library" (or nothing at all, offline).
export type SnapshotScope = 'vault' | 'home';

export interface VaultSnapshot {
  uid: string;
  bookmarks: Bookmark[];
  collections: Collection[];
  counts: Record<string, number>;
  ts: number;
}

const items: Record<SnapshotScope, ReturnType<typeof storage.defineItem<VaultSnapshot | null>>> = {
  vault: storage.defineItem<VaultSnapshot | null>('local:vault_snapshot', { fallback: null }),
  home: storage.defineItem<VaultSnapshot | null>('local:home_snapshot', { fallback: null }),
};

export async function readSnapshot(uid: string | null, scope: SnapshotScope = 'vault'): Promise<VaultSnapshot | null> {
  if (!HOSTED || !uid) return null; // local mode is already instant
  const s = await items[scope].getValue();
  return s && s.uid === uid ? s : null;
}

// The snapshot exists to paint tiles/rows instantly — it does NOT need the
// heavy fields. `content` alone can be the full text of every saved page;
// serializing that through chrome.storage on every new-tab open made Home
// slower the bigger a vault grew. Strip to paint-only fields, cap the count,
// and debounce: surfaces call this several times per open (bookmarks,
// collections and counts settle separately) — one write 400ms after the last
// call wins.
const SNAPSHOT_MAX = 300;
function slimBookmark(b: Bookmark): Bookmark {
  const { content, summary, note, aiTags, ...rest } = b;
  return rest as Bookmark;
}

const pending: Partial<Record<SnapshotScope, VaultSnapshot | null>> = {};
const timers: Partial<Record<SnapshotScope, ReturnType<typeof setTimeout>>> = {};

export async function writeSnapshot(s: Omit<VaultSnapshot, 'ts'>, scope: SnapshotScope = 'vault'): Promise<void> {
  if (!HOSTED || !s.uid) return;
  pending[scope] = { ...s, ts: Date.now(), bookmarks: s.bookmarks.slice(0, SNAPSHOT_MAX).map(slimBookmark) };
  if (timers[scope]) clearTimeout(timers[scope]);
  timers[scope] = setTimeout(() => {
    const snap = pending[scope];
    pending[scope] = null;
    timers[scope] = undefined;
    if (snap) items[scope].setValue(snap).catch(() => {});
  }, 400);
}

export async function clearSnapshot(): Promise<void> {
  // Cancel any debounced write first — a timer firing after logout would
  // re-persist the signed-out user's data right after we wiped it.
  for (const scope of ['vault', 'home'] as const) {
    if (timers[scope]) clearTimeout(timers[scope]);
    timers[scope] = undefined;
    pending[scope] = null;
    await items[scope].setValue(null);
  }
}
