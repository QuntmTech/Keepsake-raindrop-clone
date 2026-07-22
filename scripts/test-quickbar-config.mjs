import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/quickbarConfig.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
  fileName: 'lib/quickbarConfig.ts',
});
const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length) throw new Error(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));

const builtFile = join(tmpdir(), `keepsake-quickbar-config-${process.pid}-${Date.now()}.mjs`);
await writeFile(builtFile, compiled.outputText, 'utf8');
const {
  normalizeQuickBarOrder,
  reorderQuickBarAction,
  normalizeQuickBarColor,
  normalizeQuickBarUrl,
  resolveSaveCollection,
  rememberRecentCollection,
  splitRecentCollections,
  buildRelatedQuery,
  sameCanonicalUrl,
} = await import(pathToFileURL(builtFile).href);

const completeOrder = ['popup', 'search', 'related', 'save', 'folder', 'dashboard', 'custom'];

test('older Quick Bar layouts receive discovery actions beside Popup', () => {
  assert.deepEqual(normalizeQuickBarOrder(['folder', 'popup', 'save', 'dashboard', 'custom']), [
    'folder', 'popup', 'search', 'related', 'save', 'dashboard', 'custom',
  ]);
});

test('complete custom Quick Bar orders remain untouched', () => {
  assert.deepEqual(
    normalizeQuickBarOrder(['dashboard', 'save', 'popup', 'related', 'folder', 'search', 'custom']),
    ['dashboard', 'save', 'popup', 'related', 'folder', 'search', 'custom'],
  );
});

test('dragging an action before another action persists a deterministic order', () => {
  assert.deepEqual(
    reorderQuickBarAction(completeOrder, 'dashboard', 'save'),
    ['popup', 'search', 'related', 'dashboard', 'save', 'folder', 'custom'],
  );
});

test('dock colors accept safe hex values only', () => {
  assert.equal(normalizeQuickBarColor('#AbC'), '#aabbcc');
  assert.equal(normalizeQuickBarColor('#123456'), '#123456');
  assert.equal(normalizeQuickBarColor('red'), '');
});

test('custom shortcuts allow only http and https URLs', () => {
  assert.equal(normalizeQuickBarUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeQuickBarUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(normalizeQuickBarUrl('javascript:alert(1)'), '');
  assert.equal(normalizeQuickBarUrl('file:///tmp/test'), '');
});

test('explicit Unsorted never falls back to the default collection', () => {
  assert.equal(resolveSaveCollection(undefined, 'default-id', true), '');
  assert.equal(resolveSaveCollection(undefined, 'default-id', false), 'default-id');
  assert.equal(resolveSaveCollection('picked-id', 'default-id', true), 'picked-id');
});

test('recent collections are unique, newest-first, and capped', () => {
  assert.deepEqual(rememberRecentCollection(['one', 'two', 'three'], 'two'), ['two', 'one', 'three']);
  assert.deepEqual(rememberRecentCollection(['one', 'two', 'three'], 'four'), ['four', 'one', 'two']);
});

test('recent collections are split from the remaining list without duplicates', () => {
  const collections = [
    { id: 'one', name: 'One' },
    { id: 'two', name: 'Two' },
    { id: 'three', name: 'Three' },
  ];
  const split = splitRecentCollections(collections, ['three', 'one', 'missing']);
  assert.deepEqual(split.recent.map((item) => item.id), ['three', 'one']);
  assert.deepEqual(split.rest.map((item) => item.id), ['two']);
});

test('related query uses useful title and domain terms while dropping filler', () => {
  assert.equal(buildRelatedQuery('How to Build the Best Chrome Extension', 'https://developer.chrome.com/docs'), 'build best chrome extension developer');
});

test('canonical URL matching ignores tracking parameters and fragments', () => {
  assert.equal(
    sameCanonicalUrl('https://example.com/post/?utm_source=x#section', 'https://example.com/post'),
    true,
  );
});
