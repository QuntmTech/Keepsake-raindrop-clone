import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const quickbar = await readFile(new URL('../lib/quickbar.ts', import.meta.url), 'utf8');
const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const aiEmbed = await readFile(new URL('../entrypoints/ai-embed.content.ts', import.meta.url), 'utf8');
const popup = await readFile(new URL('../entrypoints/popup/App.tsx', import.meta.url), 'utf8');
const home = await readFile(new URL('../entrypoints/newtab/App.tsx', import.meta.url), 'utf8');

test('Quick Bar paints before backend hydration and supports direct horizontal resizing', () => {
  assert.match(quickbar, /class="resize-handle"/);
  assert.match(quickbar, /quickBarWidth/);
  assert.match(quickbar, /quickBarIconSize/);
  assert.match(quickbar, /Paint immediately/);
  assert.doesNotMatch(quickbar, /if \(await loggedIn\(\)\) \{\s*await refreshExisting/);
});

test('page controls wait until document_idle without blocking on backend startup', () => {
  assert.match(content, /runAt: 'document_idle'/);
  assert.doesNotMatch(content, /await getBackend\(\)/);
  assert.match(content, /mountQuickBar\(latestSettings\)/);
  assert.match(content, /KS_PAGE_NAVIGATED/);
  assert.match(content, /ctx\.onInvalidated/);
  assert.match(aiEmbed, /runAt: 'document_idle'/);
  assert.match(aiEmbed, /ctx\.onInvalidated/);
});

test('popup and Home prioritize visual data over secondary metadata', () => {
  assert.match(popup, /setTimeout\(refreshMeta, 240\)/);
  assert.match(popup, /collectionsRef\.current/);
  assert.match(home, /setTimeout\(reloadTags, 500\)/);
  assert.match(home, /setTimeout\(\(\) => \{\s*syncHomeOverlay/);
  assert.match(home, /await import\('@\/lib\/importer'\)/);
});

test('website bundle delegates data access to the background worker', () => {
  assert.doesNotMatch(quickbar, /from '\.\/backend'/);
  assert.doesNotMatch(quickbar, /from '\.\/bookmarks'/);
  assert.doesNotMatch(content, /@\/lib\/highlights/);
  assert.match(content, /KS_HIGHLIGHTS_FOR_URL/);
  assert.match(quickbar, /KS_QUICKBAR_BOOTSTRAP/);
  assert.match(quickbar, /KS_QUICKBAR_SEARCH/);
});
