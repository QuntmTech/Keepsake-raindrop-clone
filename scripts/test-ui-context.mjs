import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/uiContext.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true,
  fileName: 'lib/uiContext.ts',
});
const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
if (errors.length) {
  throw new Error(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
}

const builtFile = join(tmpdir(), `keepsake-ui-context-${process.pid}-${Date.now()}.mjs`);
await writeFile(builtFile, compiled.outputText, 'utf8');
const {
  clampQuickBarTop,
  quickBarFractionFromTop,
  quickBarSideForPointer,
  resolveSaveCollection,
} = await import(pathToFileURL(builtFile).href);

test('the collection currently being viewed beats the global save default', () => {
  assert.equal(resolveSaveCollection('watch-later', 'inbox', ['watch-later', 'inbox']), 'watch-later');
});

test('Unsorted explicitly selects no collection', () => {
  assert.equal(resolveSaveCollection(null, 'inbox', ['inbox']), '');
});

test('an invalid context falls back to a valid global default', () => {
  assert.equal(resolveSaveCollection('deleted', 'inbox', ['inbox']), 'inbox');
});

test('Quick Bar snaps to the nearest browser edge', () => {
  assert.equal(quickBarSideForPointer(100, 1000), 'left');
  assert.equal(quickBarSideForPointer(900, 1000), 'right');
});

test('Quick Bar top remains inside the viewport and round-trips its center', () => {
  assert.equal(clampQuickBarTop(0, 800, 180), 8);
  assert.equal(clampQuickBarTop(1, 800, 180), 612);
  const top = clampQuickBarTop(0.5, 800, 180);
  assert.equal(quickBarFractionFromTop(top, 800, 180), 0.5);
});
