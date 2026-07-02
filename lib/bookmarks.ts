import { getBackend } from './backend';
import { type Bookmark } from './types';
import { type SaveBookmarkInput, type SearchOpts } from './backend/types';
import { applyHomeOverlay, forgetHomeOverlay, saveHomeBookmark, updateHomeBookmark } from './home';

// The Save sidecar (IndexedDB via Dexie) must ONLY load in extension-origin
// contexts. This facade is also bundled into the content script (Quick Bar /
// highlights run inside web pages), where IndexedDB belongs to the PAGE's
// origin — loading Dexie there would write sidecar rows into the wrong
// database and drag a heavy dependency into every page. Content-script saves
// go through the background (SAVE_CURRENT_PAGE), which owns the sidecar.
const IN_EXTENSION_CONTEXT =
  typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

async function sidecar(): Promise<typeof import('./save') | null> {
  if (!IN_EXTENSION_CONTEXT) return null;
  return import('./save');
}

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
  const sc = await sidecar();
  if (sc) await sc.upsertSidecar(bm).catch(() => {});
  return bm;
}

export async function updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark> {
  const bm = await updateHomeBookmark(id, patch);
  const sc = await sidecar();
  if (sc) await sc.upsertSidecar(bm).catch(() => {});
  return bm;
}

export async function deleteBookmark(id: string): Promise<void> {
  await (await getBackend()).deleteBookmark(id);
  await forgetHomeOverlay(id);
  const sc = await sidecar();
  if (sc) sc.deleteSave(id).catch(() => {});
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
  const stats = await (await getBackend()).vaultStats();
  // Home launcher tiles are hidden from library views — the "All bookmarks"
  // count must match what those views actually show.
  const sc = await sidecar();
  if (sc) {
    try {
      const tiles = await sc.db.saves.filter((s) => Boolean(s.organization.homeOnly)).count();
      stats.total = Math.max(0, stats.total - tiles);
    } catch {
      /* raw count is still useful */
    }
  }
  return stats;
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

// Collections that exist only to group Home launcher tiles — every bookmark in
// them is a homeOnly tile. These are hidden from the library sidebars (popup +
// dashboard) so the Home catalog folders don't clutter the bookmark manager.
// Empty collections and any collection holding a real bookmark are NOT listed.
export async function homeOnlyCollectionIds(): Promise<string[]> {
  const all = await searchBookmarks('', { perPage: 5000, homeTiles: 'include' });
  const total = new Map<string, number>();
  const library = new Map<string, number>();
  for (const b of all) {
    if (!b.collection) continue;
    total.set(b.collection, (total.get(b.collection) ?? 0) + 1);
    if (!b.homeOnly) library.set(b.collection, (library.get(b.collection) ?? 0) + 1);
  }
  const ids: string[] = [];
  for (const [id, t] of total) if (t > 0 && !library.get(id)) ids.push(id);
  return ids;
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
