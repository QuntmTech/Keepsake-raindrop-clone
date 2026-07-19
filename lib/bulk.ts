import { type Bookmark } from './types';

export interface BulkRunResult {
  completed: number;
  failed: number;
}

export function selectedBookmarks(items: Bookmark[], selectedIds: ReadonlySet<string>): Bookmark[] {
  return items.filter((item) => selectedIds.has(item.id));
}

export function normalizeBulkTag(value: string): string {
  return value
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, 60);
}

export function mergeBookmarkTags(existing: string[], rawTag: string): string[] {
  const tag = normalizeBulkTag(rawTag);
  if (!tag) return [...existing];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of [...existing, tag]) {
    const normalized = normalizeBulkTag(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

// Processes large selections in small waves so a 200-item cleanup does not
// overwhelm local storage, PocketBase, or the browser service worker.
export async function runBulkTasks<T>(
  items: T[],
  worker: (item: T) => Promise<unknown>,
  concurrency = 6,
): Promise<BulkRunResult> {
  let completed = 0;
  let failed = 0;
  const size = Math.max(1, Math.floor(concurrency));

  for (let index = 0; index < items.length; index += size) {
    const batch = items.slice(index, index + size);
    const results = await Promise.allSettled(batch.map((item) => worker(item)));
    for (const result of results) {
      if (result.status === 'fulfilled') completed++;
      else failed++;
    }
  }

  return { completed, failed };
}
