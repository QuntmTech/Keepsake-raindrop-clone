import { saveBookmark } from './bookmarks';
import { getBackend } from './backend';
import { type SaveBookmarkInput } from './backend/types';
import { safeDomain, inferType, faviconFor } from './bookmarks';
import { type Bookmark } from './types';

// Import/export. Supports the Netscape bookmark HTML format that every browser
// (and raindrop.io) can export, plus Keepsake's own JSON.

export interface ParsedItem {
  url: string;
  title: string;
  tags?: string[];
}

// Parse a Netscape "Bookmarks.html" file into flat items. Folder names become tags.
export function parseNetscapeHtml(html: string): ParsedItem[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items: ParsedItem[] = [];
  doc.querySelectorAll('a[href]').forEach((a) => {
    const url = a.getAttribute('href') ?? '';
    if (!/^https?:/i.test(url)) return;
    const tagsAttr = a.getAttribute('tags');
    items.push({
      url,
      title: a.textContent?.trim() || url,
      tags: tagsAttr ? tagsAttr.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
    });
  });
  return items;
}

// Parse Keepsake JSON export (array of bookmark-like objects).
export function parseKeepsakeJson(json: string): ParsedItem[] {
  try {
    const data = JSON.parse(json);
    const arr = Array.isArray(data) ? data : data.bookmarks;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((b: any) => typeof b?.url === 'string')
      .map((b: any) => ({ url: b.url, title: b.title || b.url, tags: b.tags }));
  } catch {
    return [];
  }
}

export interface ImportProgress {
  done: number;
  total: number;
  failed: number;
}

// Import items into the vault, reporting progress. Sequential to stay gentle on
// the server and to keep memory flat for very large files.
export async function importItems(
  items: ParsedItem[],
  collection: string | undefined,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const toInput = (item: ParsedItem): SaveBookmarkInput => {
    const domain = safeDomain(item.url);
    return {
      url: item.url,
      title: item.title,
      tags: item.tags ?? [],
      collection,
      domain,
      type: inferType(item.url),
      favicon: faviconFor(domain),
    };
  };

  const backend = await getBackend();

  // Fast path: backends that support bulk import (e.g. local) write once.
  if (backend.bulkSave) {
    onProgress?.({ done: 0, total: items.length, failed: 0 });
    const saved = await backend.bulkSave(items.map(toInput));
    const result = { done: items.length, total: items.length, failed: items.length - saved };
    onProgress?.(result);
    return result;
  }

  // Fallback: one at a time.
  let done = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await saveBookmark(toInput(item));
    } catch {
      failed++;
    }
    done++;
    onProgress?.({ done, total: items.length, failed });
  }
  return { done, total: items.length, failed };
}

// Export the vault as a downloadable JSON blob.
export function exportJson(bookmarks: Bookmark[]): Blob {
  const payload = {
    app: 'keepsake',
    exportedAt: new Date().toISOString(),
    bookmarks: bookmarks.map((b) => ({
      url: b.url,
      title: b.title,
      description: b.description,
      summary: b.summary,
      note: b.note,
      tags: b.tags,
      domain: b.domain,
      type: b.type,
      favorite: b.favorite,
      created: b.created,
    })),
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
