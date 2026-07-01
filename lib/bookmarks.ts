import { getBackend } from './backend';
import { type Bookmark } from './types';
import { type SaveBookmarkInput, type SearchOpts } from './backend/types';
import { applyHomeOverlay, forgetHomeOverlay, saveHomeBookmark, updateHomeBookmark } from './home';
import { deleteSave, upsertSidecar } from './save';

// Facade over the active backend. Components import from here regardless of
// whether data lives in chrome.storage (local) or PocketBase.

export type { SaveBookmarkInput, SearchOpts };

// Home app tiles (added from the catalog, `homeOnly`) live in the same store
// but are NOT library bookmarks: hide them from library views by default.
// Home passes homeTiles: 'include'; explicit collection views keep them so a
// cluster collection isn't an empty folder in the dashboard.
export interface LibrarySearchOpts extends SearchOpts {
  homeTiles?: 'include' | 'exclude';
}

// Re-export pure helpers so existing imports (`@/lib/bookmarks`) keep working.
export { safeDomain, inferType, faviconFor } from './util';

// Writes go through the Home-field verifiers (lib/home.ts): if the server
// schema drops pinned/sort/homeOnly, they land in the overlay instead of
// vanishing. Saves without those fields behave exactly as before.
export async function saveBookmark(input: SaveBookmarkInput): Promise<Bookmark> {
  const bm = await saveHomeBookmark(input);
  // Sidecar: mirror into the IndexedDB Save store (the AI-native layer).
  // Awaited so callers (auto-file, popup close) can rely on the row existing;
  // a sidecar failure still never fails the user's save.
  await upsertSidecar(bm).catch(() => {});
  return bm;
}

export async function updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark> {
  const bm = await updateHomeBookmark(id, patch);
  await upsertSidecar(bm).catch(() => {});
  return bm;
}

export async function deleteBookmark(id: string): Promise<void> {
  await (await getBackend()).deleteBookmark(id);
  await forgetHomeOverlay(id);
  deleteSave(id).catch(() => {});
}

export async function toggleFavorite(id: string, favorite: boolean): Promise<Bookmark> {
  return (await getBackend()).updateBookmark(id, { favorite });
}

export async function markVisited(id: string): Promise<void> {
  return (await getBackend()).markVisited(id);
}

export async function searchBookmarks(query: string, opts: LibrarySearchOpts = {}): Promise<Bookmark[]> {
  const { homeTiles, ...backendOpts } = opts;
  const filtering = homeTiles !== 'include' && !backendOpts.collection;
  // The homeOnly filter runs AFTER backend pagination, so over-fetch when
  // filtering — otherwise a page of recent launcher tiles would return an
  // empty "recent" list even though older real bookmarks exist.
  const perPage = backendOpts.perPage ?? 60;
  const fetchOpts = filtering ? { ...backendOpts, perPage: Math.min(perPage * 2 + 20, 500) } : backendOpts;
  const items = await (await getBackend()).searchBookmarks(query, fetchOpts);
  const merged = await applyHomeOverlay(items);
  if (!filtering) return merged;
  return merged.filter((b) => !b.homeOnly).slice(0, perPage);
}

export async function recentBookmarks(limit = 12): Promise<Bookmark[]> {
  return searchBookmarks('', { perPage: limit });
}

export async function findByUrl(url: string): Promise<Bookmark | null> {
  const bm = await (await getBackend()).findByUrl(url);
  if (!bm) return null;
  return (await applyHomeOverlay([bm]))[0];
}

export async function getAllTags(): Promise<{ tag: string; count: number }[]> {
  return (await getBackend()).getAllTags();
}

export async function vaultStats() {
  return (await getBackend()).vaultStats();
}

export async function listCollections() {
  return (await getBackend()).listCollections();
}

export async function createCollection(data: {
  name: string;
  color?: string;
  icon?: string;
  parent?: string;
}) {
  return (await getBackend()).createCollection(data);
}

export async function updateCollection(id: string, patch: Parameters<Awaited<ReturnType<typeof getBackend>>['updateCollection']>[1]) {
  return (await getBackend()).updateCollection(id, patch);
}

export async function deleteCollection(id: string): Promise<void> {
  return (await getBackend()).deleteCollection(id);
}

export async function countByCollection(): Promise<Record<string, number>> {
  return (await getBackend()).countByCollection();
}

// Subscribe to vault changes (saves/edits/deletes from any context) so open
// surfaces refresh live. Returns an unsubscribe function.
export function watchVault(cb: () => void): () => void {
  let unsub = () => {};
  let cancelled = false;
  getBackend().then((b) => {
    if (cancelled) return;
    unsub = b.watch?.(cb) ?? (() => {});
  });
  return () => {
    cancelled = true;
    unsub();
  };
}
