import { pb, currentUserId, fileUrl } from './pocketbase';
import { type Bookmark, type Collection } from './types';

// ---- Bookmarks --------------------------------------------------------------

export interface SaveBookmarkInput {
  url: string;
  title: string;
  description?: string;
  tags?: string[];
  collection?: string;
  screenshotBlob?: Blob; // auto-preview image captured by the background worker
}

export async function saveBookmark(input: SaveBookmarkInput): Promise<Bookmark> {
  const user = currentUserId();
  if (!user) throw new Error('Not logged in');

  const domain = safeDomain(input.url);

  // PocketBase accepts multipart FormData when a file is attached.
  const form = new FormData();
  form.set('url', input.url);
  form.set('title', input.title);
  form.set('description', input.description ?? '');
  form.set('tags', JSON.stringify(input.tags ?? []));
  if (input.collection) form.set('collection', input.collection);
  form.set('domain', domain);
  form.set('user', user);
  if (input.screenshotBlob) {
    form.set('screenshot', input.screenshotBlob, `${Date.now()}.jpg`);
  }

  const rec = await pb.collection('bookmarks').create(form);
  return normalizeBookmark(rec);
}

export async function updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark> {
  const body: Record<string, unknown> = { ...patch };
  if (patch.tags) body.tags = JSON.stringify(patch.tags);
  const rec = await pb.collection('bookmarks').update(id, body);
  return normalizeBookmark(rec);
}

export async function deleteBookmark(id: string): Promise<void> {
  await pb.collection('bookmarks').delete(id);
}

// Full-text search. PocketBase's `~` operator does a LIKE match.
// Searches title, url, description, and tags. Optionally scope to a collection.
export async function searchBookmarks(
  query: string,
  opts: { collection?: string; tag?: string; page?: number; perPage?: number } = {},
): Promise<Bookmark[]> {
  const user = currentUserId();
  if (!user) throw new Error('Not logged in');

  const filters: string[] = [`user = "${user}"`];
  if (query.trim()) {
    const q = query.replace(/"/g, '\\"');
    filters.push(
      `(title ~ "${q}" || url ~ "${q}" || description ~ "${q}" || tags ~ "${q}")`,
    );
  }
  if (opts.collection) filters.push(`collection = "${opts.collection}"`);
  if (opts.tag) filters.push(`tags ~ "${opts.tag}"`);

  const list = await pb.collection('bookmarks').getList(opts.page ?? 1, opts.perPage ?? 50, {
    filter: filters.join(' && '),
    sort: '-created',
  });
  return list.items.map(normalizeBookmark);
}

export async function recentBookmarks(limit = 20): Promise<Bookmark[]> {
  return searchBookmarks('', { perPage: limit });
}

// ---- Collections ------------------------------------------------------------

export async function listCollections(): Promise<Collection[]> {
  const user = currentUserId();
  if (!user) throw new Error('Not logged in');
  const list = await pb.collection('collections').getFullList({
    filter: `user = "${user}"`,
    sort: 'name',
  });
  return list as unknown as Collection[];
}

export async function createCollection(name: string, color?: string): Promise<Collection> {
  const user = currentUserId();
  if (!user) throw new Error('Not logged in');
  const rec = await pb.collection('collections').create({ name, color, user });
  return rec as unknown as Collection;
}

// ---- helpers ----------------------------------------------------------------

function normalizeBookmark(rec: any): Bookmark {
  return {
    id: rec.id,
    url: rec.url,
    title: rec.title,
    description: rec.description,
    tags: parseTags(rec.tags),
    collection: rec.collection || undefined,
    cover: rec.cover || undefined,
    screenshot: rec.screenshot ? fileUrl(rec, rec.screenshot) : undefined,
    domain: rec.domain,
    user: rec.user,
    created: rec.created,
    updated: rec.updated,
  };
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
