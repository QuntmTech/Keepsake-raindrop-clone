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
  assert.doesNotMatch(queue, /queue\.slice\(-100\)/);
  assert.match(queue, /remaining\.push\(item, \.\.\.queue\.slice\(index \+ 1\)\)/);
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


test('highlight storage stays out of the every-page bundle', () => {
  assert.doesNotMatch(content, /@\/lib\/highlights/);
  assert.match(background, /KS_HIGHLIGHT_CREATE/);
  assert.match(background, /KS_HIGHLIGHTS_FOR_URL/);
});


test('Recall cache writes are serialized and stale tabs cannot reappear', () => {
  assert.match(background, /mutateRecallCache/);
  assert.match(background, /liveTab\.url !== url/);
});
