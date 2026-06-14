import { getBackend } from './backend';
import { type Bookmark } from './types';
import { type SaveBookmarkInput, type SearchOpts } from './backend/types';

// Facade over the active backend. Components import from here regardless of
// whether data lives in chrome.storage (local) or PocketBase.

export type { SaveBookmarkInput, SearchOpts };

// Re-export pure helpers so existing imports (`@/lib/bookmarks`) keep working.
export { safeDomain, inferType, faviconFor } from './util';

export async function saveBookmark(input: SaveBookmarkInput): Promise<Bookmark> {
  return (await getBackend()).saveBookmark(input);
}

export async function updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark> {
  return (await getBackend()).updateBookmark(id, patch);
}

export async function deleteBookmark(id: string): Promise<void> {
  return (await getBackend()).deleteBookmark(id);
}

export async function toggleFavorite(id: string, favorite: boolean): Promise<Bookmark> {
  return (await getBackend()).updateBookmark(id, { favorite });
}

export async function markVisited(id: string): Promise<void> {
  return (await getBackend()).markVisited(id);
}

export async function searchBookmarks(query: string, opts: SearchOpts = {}): Promise<Bookmark[]> {
  return (await getBackend()).searchBookmarks(query, opts);
}

export async function recentBookmarks(limit = 12): Promise<Bookmark[]> {
  return searchBookmarks('', { perPage: limit });
}

export async function findByUrl(url: string): Promise<Bookmark | null> {
  return (await getBackend()).findByUrl(url);
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
