import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../lib/quickbar.ts', import.meta.url), 'utf8');

test('Quick Bar controls expose instant inward-facing labels', () => {
  for (const label of [
    'Open dropdown',
    'Search Keepsake',
    'Browse collections',
    'Save page',
    'Choose collection',
    'Open dashboard',
    'Customize Quick Bar',
  ]) {
    assert.match(source, new RegExp('data-tooltip="' + label.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&') + '"'));
  }
  assert.match(source, /\[data-tooltip\]:hover::after/);
  assert.match(source, /\[data-tooltip\]:focus-visible::after/);
  assert.match(source, /transition-delay: \.08s/);
  assert.match(source, /\.rail\.right \[data-tooltip\]::after/);
  assert.match(source, /\.rail\.left \[data-tooltip\]::after/);
});

test('dynamic labels explain duplicate, related, and custom states', () => {
  assert.match(source, /saveButton\.dataset\.tooltip = existingBookmark/);
  assert.match(source, /relatedButton\.dataset\.tooltip = related\.length/);
  assert.match(source, /customButton\.dataset\.tooltip = currentSettings\.quickBarCustomLabel/);
});


test('collection launcher opens inward with searchable bookmark drill-down', () => {
  assert.match(source, /data-action="browse"/);
  assert.match(source, /async function openCollectionLauncher/);
  assert.match(source, /async function openCollectionBookmarks/);
  assert.match(source, /countByCollection/);
  assert.match(source, /input\.placeholder = 'Search ' \+ label\.toLowerCase\(\)/);
});
