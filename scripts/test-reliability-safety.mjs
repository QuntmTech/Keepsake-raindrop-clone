import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const queue = await readFile(new URL('../lib/queue.ts', import.meta.url), 'utf8');
const pocketbase = await readFile(new URL('../lib/backend/pocketbase.ts', import.meta.url), 'utf8');

test('SPA changes use the supported webNavigation bridge', () => {
  assert.match(background, /onHistoryStateUpdated/);
  assert.match(background, /KS_PAGE_NAVIGATED/);
  assert.match(content, /KS_PAGE_NAVIGATED/);
  assert.doesNotMatch(content, /locationWatcher/);
});

test('offline queue serializes mutations and deduplicates ambiguous creates', () => {
  assert.match(queue, /withQueueLock/);
  assert.match(queue, /findByUrl\(input\.url\)/);
  assert.match(queue, /sameDestination/);
  assert.match(queue, /queue\.slice\(-100\)/);
});

test('create operations are not replayed after ambiguous failures', () => {
  assert.match(pocketbase, /\[400, 404, 405, 422\]\.includes\(status\)/);
  assert.match(pocketbase, /bookmarks'\)\.create\(form\), 0/);
});

test('save UX bounds enrichment and queues transient failures only', () => {
  assert.match(background, /settleWithin\(metaPromise, 1800, null\)/);
  assert.match(background, /status === 408/);
  assert.match(background, /status: 'blocked'/);
});
