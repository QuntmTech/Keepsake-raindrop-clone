import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../lib/retrieval.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
  fileName: 'lib/retrieval.ts',
});
const errors = (compiled.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
if (errors.length) {
  throw new Error(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'),
  );
}

const builtFile = join(tmpdir(), `keepsake-retrieval-${process.pid}-${Date.now()}.mjs`);
await writeFile(builtFile, compiled.outputText, 'utf8');
const { bestSnippet, queryTerms, rankBookmarks } = await import(pathToFileURL(builtFile).href);

function bookmark(id, patch = {}) {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Bookmark ${id}`,
    tags: [],
    aiTags: [],
    favorite: false,
    pinned: false,
    homeOnly: false,
    user: 'user-1',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

test('queryTerms removes conversational filler and keeps useful unique terms', () => {
  assert.deepEqual(queryTerms('What did I save about AI AI productivity?'), ['ai', 'productivity']);
});

test('title and tags outrank a weak body-only match', () => {
  const ranked = rankBookmarks('flight deals', [
    bookmark('body', { content: 'A long page that briefly mentions flight deals once.' }),
    bookmark('title', { title: 'Best Flight Deals', tags: ['travel'] }),
  ]);
  assert.equal(ranked[0]?.bookmark.id, 'title');
  assert.equal(ranked[1]?.bookmark.id, 'body');
});

test('Home-only launcher tiles are excluded and duplicate ids are returned once', () => {
  const ranked = rankBookmarks('calendar', [
    bookmark('home', { title: 'Calendar', homeOnly: true }),
    bookmark('real', { title: 'Calendar workflow' }),
    bookmark('real', { title: 'Calendar duplicate copy' }),
  ]);
  assert.deepEqual(ranked.map((item) => item.bookmark.id), ['real']);
});

test('bestSnippet selects the field with the strongest query evidence', () => {
  const item = bookmark('snippet', {
    note: 'Remember to review this later.',
    description: 'General product overview.',
    content: 'The pricing comparison explains annual billing, monthly billing, and trial terms in detail.',
  });
  assert.match(bestSnippet(item, 'annual billing'), /annual billing/i);
});

test('exact phrase matches beat scattered individual terms', () => {
  const ranked = rankBookmarks('design system', [
    bookmark('scattered', { title: 'Design notes for a component system' }),
    bookmark('phrase', { title: 'Design System Handbook' }),
  ]);
  assert.equal(ranked[0]?.bookmark.id, 'phrase');
});
