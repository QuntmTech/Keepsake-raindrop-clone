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
} = await import(pathToFileURL(builtFile).href);

test('Quick Bar order is unique, valid, and always complete', () => {
  assert.deepEqual(normalizeQuickBarOrder(['folder', 'popup', 'folder', 'bad']), [
    'folder', 'popup', 'save', 'dashboard', 'custom',
  ]);
});

test('dragging an action before another action persists a deterministic order', () => {
  assert.deepEqual(
    reorderQuickBarAction(['popup', 'save', 'folder', 'dashboard', 'custom'], 'dashboard', 'save'),
    ['popup', 'dashboard', 'save', 'folder', 'custom'],
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
