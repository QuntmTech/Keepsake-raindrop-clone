import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/bulk.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
  fileName: 'lib/bulk.ts',
});
const errors = (compiled.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
if (errors.length) {
  throw new Error(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'),
  );
}

const builtFile = join(tmpdir(), `keepsake-bulk-${process.pid}-${Date.now()}.mjs`);
await writeFile(builtFile, compiled.outputText, 'utf8');
const { mergeBookmarkTags, normalizeBulkTag, runBulkTasks, selectedBookmarks } = await import(
  pathToFileURL(builtFile).href
);

function bookmark(id, patch = {}) {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Bookmark ${id}`,
    tags: [],
    type: 'link',
    user: 'user-1',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

test('normalizeBulkTag trims hashes, spacing, case, and length', () => {
  assert.equal(normalizeBulkTag('  ###Product   Research  '), 'product research');
  assert.equal(normalizeBulkTag('x'.repeat(80)).length, 60);
});

test('mergeBookmarkTags preserves order while removing case-insensitive duplicates', () => {
  assert.deepEqual(mergeBookmarkTags(['Travel', 'deals'], '#TRAVEL'), ['travel', 'deals']);
  assert.deepEqual(mergeBookmarkTags(['travel'], 'Flight Deals'), ['travel', 'flight deals']);
});

test('selectedBookmarks returns only visible selected records', () => {
  const items = [bookmark('a'), bookmark('b'), bookmark('c')];
  assert.deepEqual(
    selectedBookmarks(items, new Set(['b', 'missing'])).map((item) => item.id),
    ['b'],
  );
});

test('runBulkTasks completes every item and reports individual failures', async () => {
  const visited = [];
  const result = await runBulkTasks(
    [1, 2, 3, 4, 5],
    async (value) => {
      visited.push(value);
      if (value === 3) throw new Error('expected failure');
    },
    2,
  );
  assert.deepEqual(visited.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.deepEqual(result, { completed: 4, failed: 1 });
});
