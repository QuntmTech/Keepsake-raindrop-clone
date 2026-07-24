import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const source = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

async function importTypescriptModule(path, exportName) {
  const input = await source(path);
  const compiled = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
    fileName: path,
  });
  const errors = (compiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'));
  const builtFile = join(tmpdir(), 'keepsake-8151-' + exportName + '-' + process.pid + '-' + Date.now() + '.mjs');
  await writeFile(builtFile, compiled.outputText, 'utf8');
  return import(pathToFileURL(builtFile).href);
}

test('AI Writer detaches stale selections and invalidates stale results', async () => {
  const writer = await source('components/AIWriter.tsx');
  assert.match(writer, /function changeSourceText\(value: string\)/);
  assert.match(writer, /setSelection\(null\)/);
  assert.match(writer, /setUndoAvailable\(false\)/);
  assert.match(writer, /patch\(\{ input: value, output: '' \}\)/);
  assert.match(writer, /tone: event\.target\.value as WriterTone, output: ''/);
  assert.match(writer, /length: event\.target\.value as WriterLength, output: ''/);
  assert.match(writer, /quality, output: ''/);
  assert.match(writer, /Clipboard access failed/);
  assert.match(writer, /disabled=\{busy\}/);
});

test('manual balanced routing cannot silently escalate to the best model', async () => {
  const catalog = await source('lib/modelCatalog.ts');
  assert.match(catalog, /request\.mode === 'balanced' \? unique\(\[balanced, economy\]\)/);
});

test('retry backoff exits immediately when the request is cancelled', async () => {
  const llm = await source('lib/llm.ts');
  assert.match(llm, /async function abortableDelay/);
  assert.match(llm, /await abortableDelay\(350 \+ Math\.round\(Math\.random\(\) \* 250\), req\.signal\)/);
  assert.match(llm, /function timeoutSignal/);
});

test('integrity checks count repeated negations and preserve numeric dates and phone numbers', async () => {
  const module = await importTypescriptModule('lib/writerIntegrity.ts', 'writer-integrity');
  const issues = module.checkWriterIntegrity(
    'Do not delete it. Do not cancel. Call (704) 555-1212 on 07/23/2026. The price is $97.',
    'Do not delete it. Call on 07/24/2026. The price is $79.',
    'improve',
  );
  assert.ok(issues.some((issue) => issue.kind === 'negation'));
  assert.ok(issues.some((issue) => issue.kind === 'phone'));
  assert.ok(issues.some((issue) => issue.kind === 'date'));
  assert.ok(issues.some((issue) => issue.kind === 'number'));
});

test('release metadata is 8.16.0', async () => {
  const pkg = JSON.parse(await source('package.json'));
  const config = await source('wxt.config.ts');
  assert.equal(pkg.version, '8.16.0');
  assert.match(config, /version: '8\.16\.0'/);
});
