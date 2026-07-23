import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Quick Bar search, collection, and related rows use lazy visual thumbnails', async () => {
  const quickbar = await source('lib/quickbar.ts');
  assert.match(quickbar, /function youtubeThumbnail/);
  assert.match(quickbar, /createBookmarkThumbnail\(bookmark\)/);
  assert.match(quickbar, /visual\.cover, visual\.screenshot, visual\.favicon/);
  assert.match(quickbar, /image\.loading = 'lazy'/);
  assert.match(quickbar, /image\.referrerPolicy = 'no-referrer'/);
  assert.match(quickbar, /result-play/);
});

test('Living Bookmarks create no repeating alarm when there are no watches', async () => {
  const [watch, background] = await Promise.all([
    source('lib/watch.ts'),
    source('entrypoints/background.ts'),
  ]);
  assert.match(watch, /browser\.alarms\.clear\(WATCH_ALARM\)/);
  assert.match(watch, /await ensureOffscreen\(\)/);
  assert.match(watch, /scheduleWatchAlarm\(\);/);
  assert.doesNotMatch(background, /WATCH_ALARM[\s\S]{0,180}ensureOffscreenDocument/);
});

test('the main content script waits until document idle', async () => {
  const content = await source('entrypoints/content.ts');
  assert.match(content, /runAt: 'document_idle'/);
});
