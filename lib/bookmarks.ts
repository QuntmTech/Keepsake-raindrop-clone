import { getBackend } from './backend';
import { type Bookmark } from './types';
import { type SaveBookmarkInput, type SearchOpts } from './backend/types';
import { applyHomeOverlay, forgetHomeOverlay, saveHomeBookmark, updateHomeBookmark } from './home';

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
  return saveHomeBookmark(input);
}

export async function updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark> {
  return updateHomeBookmark(id, patch);
}

export async function deleteBookmark(id: string): Promise<void> {
  await (await getBackend()).deleteBookmark(id);
  await forgetHomeOverlay(id);
}

export async function toggleFavorite(id: string, favorite: boolean): Promise<Bookmark> {
  return (await getBackend()).updateBookmark(id, { favorite });
}

export async function markVisited(id: string): Promise<void> {
  return (await getBackend()).markVisited(id);
}

export async function searchBookmarks(query: string, opts: LibrarySearchOpts = {}): Promise<Bookmark[]> {
  const { homeTiles, ...backendOpts } = opts;
  const items = await (await getBackend()).searchBookmarks(query, backendOpts);
  const merged = await applyHomeOverlay(items);
  if (homeTiles === 'include' || backendOpts.collection) return merged;
  return merged.filter((b) => !b.homeOnly);
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
