import { fetchAllBookmarks, saveBookmark, searchBookmarks } from './bookmarks';
import { getBackend } from './backend';
import { type SaveBookmarkInput } from './backend/types';
import { safeDomain, inferType, faviconFor } from './bookmarks';
import { canonicalUrl, db, migrateToSaves } from './save';
import { type Bookmark } from './types';

// Import/export — the escape hatch (Phase 4). Supports the Netscape bookmark
// HTML format every browser exports (Chrome, Firefox, Pocket's ril_export,
// raindrop.io HTML), Raindrop CSV, Pocket CSV, and Keepsake's own JSON.
// Everything imported is piped through the Phase-1 batch queue afterwards:
// sidecar Saves get created, then embedded + auto-filed a few per minute.

export interface ParsedItem {
  url: string;
  title: string;
  tags?: string[];
  description?: string;
}

// Parse a Netscape "Bookmarks.html" file into flat items. Folder names become
// tags — REAL folders too, not just Firefox's `tags` attribute: Chrome/Edge/
// Safari exports carry the user's whole organization as nested <DL>/<H3>
// folders, and a flat parse silently threw all of it away.
export function parseNetscapeHtml(html: string): ParsedItem[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items: ParsedItem[] = [];

  // Map each <a> to its enclosing folder names by walking up the <dl> chain;
  // each <dl>'s folder name is the <h3> in the <dt> that contains it.
  const folderOf = (el: Element): string[] => {
    const names: string[] = [];
    let node: Element | null = el;
    while (node) {
      const dl: Element | null = node.closest('dl');
      if (!dl) break;
      const dt = dl.parentElement?.tagName === 'DT' ? dl.parentElement : null;
      const h3 = dt ? Array.from(dt.children).find((c) => c.tagName === 'H3') : null;
      const name = h3?.textContent?.trim();
      // Skip the container pseudo-folders browsers wrap everything in.
      if (name && !/^(bookmarks( bar| menu)?|other bookmarks|favorites( bar)?|imported)$/i.test(name)) {
        names.unshift(name);
      }
      node = dl.parentElement;
    }
    return names;
  };

  doc.querySelectorAll('a[href]').forEach((a) => {
    const url = a.getAttribute('href') ?? '';
    if (!/^https?:/i.test(url)) return;
    const tagsAttr = a.getAttribute('tags');
    const attrTags = tagsAttr ? tagsAttr.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const tags = [...new Set([...attrTags, ...folderOf(a)])];
    items.push({
      url,
      title: a.textContent?.trim() || url,
      tags: tags.length ? tags : undefined,
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

// Minimal RFC-4180 CSV parser: quoted fields, embedded commas/newlines/quotes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function csvToObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => (obj[h] = r[i] ?? ''));
    return obj;
  });
}

// Raindrop CSV export: id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite
export function parseRaindropCsv(text: string): ParsedItem[] {
  return csvToObjects(text)
    .filter((r) => /^https?:/i.test(r.url ?? ''))
    .map((r) => ({
      url: r.url,
      title: r.title?.trim() || r.url,
      description: r.excerpt?.trim() || r.note?.trim() || undefined,
      tags: [
        ...(r.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
        // Folder path becomes a tag so nothing about the user's structure is lost.
        ...(r.folder ? [r.folder.split('/').pop()!.trim().toLowerCase()] : []),
      ].filter(Boolean),
    }));
}

// Pocket CSV export: title,url,time_added,tags,status
export function parsePocketCsv(text: string): ParsedItem[] {
  return csvToObjects(text)
    .filter((r) => /^https?:/i.test(r.url ?? ''))
    .map((r) => ({
      url: r.url,
      title: r.title?.trim() || r.url,
      tags: (r.tags ?? '').split(/[,|]/).map((t) => t.trim()).filter(Boolean),
    }));
}

export type ImportFormat = 'keepsake-json' | 'raindrop-csv' | 'pocket-csv' | 'netscape-html';

// Sniff the format from the filename + content and parse. One entry point for
// every "escape hatch" source.
export function detectAndParse(filename: string, text: string): { format: ImportFormat; items: ParsedItem[] } {
  const name = filename.toLowerCase();
  if (name.endsWith('.json')) return { format: 'keepsake-json', items: parseKeepsakeJson(text) };
  if (name.endsWith('.csv')) {
    const header = text.slice(0, 500).toLowerCase();
    if (header.includes('time_added')) return { format: 'pocket-csv', items: parsePocketCsv(text) };
    return { format: 'raindrop-csv', items: parseRaindropCsv(text) };
  }
  return { format: 'netscape-html', items: parseNetscapeHtml(text) };
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
      description: item.description,
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

export interface EscapeHatchResult extends ImportProgress {
  duplicates: number; // skipped: already in the library (canonical-URL match)
  queuedForAi: number; // new Saves handed to the batch queue (embed + auto-file)
}

// The full escape hatch: canonical-URL dedupe against the existing library,
// import what's new, then hand everything to the Phase-1 batch queue (the
// sidecar sweep creates Save rows; the queue embeds + auto-files them at a
// polite rate — no giant synchronous AI pass).
export async function importWithAi(
  items: ParsedItem[],
  collection: string | undefined,
  onProgress?: (p: ImportProgress) => void,
): Promise<EscapeHatchResult> {
  // Dedupe inside the file AND against the library, both by canonical URL.
  // Home launcher tiles don't count as library content — importing a URL the
  // user merely has as a Home tile must still create a real bookmark.
  const seen = new Set<string>();
  const canons = items.map((i) => canonicalUrl(i.url));
  const existing = new Set(
    (await db.saves.where('canonicalUrl').anyOf([...new Set(canons)]).toArray())
      .filter((s) => !s.organization.homeOnly)
      .map((s) => s.canonicalUrl),
  );
  const fresh: ParsedItem[] = [];
  items.forEach((item, i) => {
    const c = canons[i];
    if (existing.has(c) || seen.has(c)) return;
    seen.add(c);
    fresh.push(item);
  });
  const duplicates = items.length - fresh.length;

  const progress = await importItems(fresh, collection, onProgress);

  // Create sidecar Saves for the batch (idempotent sweep), which is exactly
  // what the alarms queue polls for unembedded/unfiled work.
  const queuedForAi = await migrateToSaves(
    fetchAllBookmarks, // paged full fetch — a clamped single page must never drive the orphan diff
    { respectExisting: false }, // imported rows should flow through the AI queue
  ).catch(() => 0);

  return { ...progress, duplicates, queuedForAi };
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
      // Home layout survives a backup/restore round trip.
      pinned: b.pinned,
      homeOnly: b.homeOnly,
      sort: b.sort,
      collection: b.collection,
      created: b.created,
    })),
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}
