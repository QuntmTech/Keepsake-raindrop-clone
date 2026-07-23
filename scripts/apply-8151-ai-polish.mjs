import { readFile, writeFile, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const fileUrl = (path) => new URL(path, root);
const read = (path) => readFile(fileUrl(path), 'utf8');
const write = (path, content) => writeFile(fileUrl(path), content, 'utf8');

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}

async function patchAiWriter() {
  let source = await read('components/AIWriter.tsx');

  source = replaceOnce(
    source,
    `  function patch(patchValue: Partial<WriterDraft>) {\n    setDraft((current) => ({ ...current, ...patchValue }));\n    setError('');\n    setStatus('');\n    if ('input' in patchValue || 'output' in patchValue || 'action' in patchValue) setResultMeta(null);\n  }`,
    `  function patch(patchValue: Partial<WriterDraft>) {\n    setDraft((current) => ({ ...current, ...patchValue }));\n    setError('');\n    setStatus('');\n    if ('input' in patchValue || 'output' in patchValue || 'action' in patchValue) setResultMeta(null);\n  }\n\n  function changeSourceText(value: string) {\n    setSelection(null);\n    setUndoAvailable(false);\n    patch({ input: value, output: '' });\n  }`,
    'AI Writer source detachment helper',
  );

  source = replaceOnce(
    source,
    `  async function handleCustomInstruction(value: string) {\n    patch({ customInstruction: value, selectedPromptId: '' });`,
    `  async function handleCustomInstruction(value: string) {\n    patch({ customInstruction: value, selectedPromptId: '', output: '' });`,
    'custom prompt invalidates stale result',
  );

  source = replaceOnce(
    source,
    `  function cancelGeneration() {\n    requestController.current?.abort();\n  }`,
    `  function cancelGeneration() {\n    setStatus('Cancelling…');\n    requestController.current?.abort();\n  }`,
    'immediate cancel feedback',
  );

  source = replaceOnce(
    source,
    `  async function copyOutput() {\n    if (!draft.output) return;\n    await navigator.clipboard.writeText(draft.output);\n    setStatus('Copied to clipboard.');\n  }`,
    `  async function copyOutput() {\n    if (!draft.output) return;\n    try {\n      await navigator.clipboard.writeText(draft.output);\n      setStatus('Copied to clipboard.');\n    } catch {\n      setError('Clipboard access failed. Select the result and copy it manually.');\n    }\n  }`,
    'clipboard failure handling',
  );

  source = replaceOnce(
    source,
    `          <button className="btn-ghost shrink-0 px-2 text-xs" onClick={grabSelection} title="Load selected text from the webpage">`,
    `          <button className="btn-ghost shrink-0 px-2 text-xs" onClick={grabSelection} disabled={busy} title="Load selected text from the webpage">`,
    'disable selection capture during generation',
  );

  source = replaceOnce(
    source,
    `            maxLength={48_000}\n            placeholder=`,
    `            maxLength={48_000}\n            disabled={busy}\n            placeholder=`,
    'disable source editing during generation',
  );

  source = replaceOnce(
    source,
    `            onChange={(event) => patch({ input: event.target.value, output: '' })}`,
    `            onChange={(event) => changeSourceText(event.target.value)}`,
    'manual source edits detach captured selection',
  );

  source = replaceOnce(
    source,
    `onChange={(event) => patch({ tone: event.target.value as WriterTone })}`,
    `onChange={(event) => patch({ tone: event.target.value as WriterTone, output: '' })} disabled={busy}`,
    'tone changes invalidate output',
  );

  source = replaceOnce(
    source,
    `onChange={(event) => patch({ length: event.target.value as WriterLength })}`,
    `onChange={(event) => patch({ length: event.target.value as WriterLength, output: '' })} disabled={busy}`,
    'length changes invalidate output',
  );

  source = replaceOnce(
    source,
    `value={draft.targetLanguage} onChange={(event) => patch({ targetLanguage: event.target.value })}`,
    `value={draft.targetLanguage} onChange={(event) => patch({ targetLanguage: event.target.value, output: '' })} disabled={busy}`,
    'translation target invalidates output',
  );

  source = replaceOnce(
    source,
    `onClick={() => patch({ quality })}`,
    `onClick={() => patch({ quality, output: '' })} disabled={busy}`,
    'quality changes invalidate output',
  );

  source = replaceOnce(
    source,
    `            className="input mt-3 text-xs"\n            value={draft.selectedPromptId}`,
    `            className="input mt-3 text-xs"\n            value={draft.selectedPromptId}\n            disabled={busy}`,
    'disable prompt selection during generation',
  );

  source = replaceOnce(
    source,
    `              else patch({ selectedPromptId: '' });`,
    `              else patch({ selectedPromptId: '', customInstruction: '', output: '' });`,
    'clearing saved prompt clears stale instruction',
  );

  source = replaceOnce(
    source,
    `            maxLength={1200}\n            placeholder=`,
    `            maxLength={1200}\n            disabled={busy}\n            placeholder=`,
    'disable custom prompt editing during generation',
  );

  source = replaceOnce(
    source,
    `            <textarea className="min-h-48 w-full resize-y rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink outline-none focus:border-brand" value={draft.output} onChange={(event) => patch({ output: event.target.value })} />`,
    `            <textarea className="min-h-48 w-full resize-y rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink outline-none focus:border-brand" value={draft.output} disabled={busy} onChange={(event) => patch({ output: event.target.value })} />`,
    'disable output editing during generation',
  );

  source = replaceOnce(
    source,
    `<button className="btn-ghost justify-center" onClick={copyOutput}><Icon name="copy" size={14} /> Copy</button>`,
    `<button className="btn-ghost justify-center" onClick={copyOutput} disabled={busy}><Icon name="copy" size={14} /> Copy</button>`,
    'disable copy during generation',
  );

  source = replaceOnce(
    source,
    `<button className="btn-ghost justify-center" onClick={saveOutput}><Icon name="bookmark" size={14} /> Save</button>`,
    `<button className="btn-ghost justify-center" onClick={saveOutput} disabled={busy}><Icon name="bookmark" size={14} /> Save</button>`,
    'disable save during generation',
  );

  source = replaceOnce(
    source,
    `disabled={!selection?.editable}`,
    `disabled={busy || !selection?.editable}`,
    'disable replacement during generation',
  );

  await write('components/AIWriter.tsx', source);
}

async function patchLlm() {
  let source = await read('lib/llm.ts');
  source = replaceOnce(
    source,
    `function requestSignal(timeout = REQUEST_TIMEOUT_MS, external?: AbortSignal): AbortSignal {\n  return combineSignals([external, AbortSignal.timeout(timeout)]);\n}`,
    `function timeoutSignal(timeout: number): AbortSignal {\n  const signalApi = AbortSignal as typeof AbortSignal & { timeout?: (milliseconds: number) => AbortSignal };\n  if (signalApi.timeout) return signalApi.timeout(timeout);\n  const controller = new AbortController();\n  setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeout);\n  return controller.signal;\n}\n\nfunction requestSignal(timeout = REQUEST_TIMEOUT_MS, external?: AbortSignal): AbortSignal {\n  return combineSignals([external, timeoutSignal(timeout)]);\n}\n\nasync function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {\n  if (!signal) {\n    await new Promise((resolve) => setTimeout(resolve, milliseconds));\n    return;\n  }\n  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');\n  await new Promise<void>((resolve, reject) => {\n    const finish = () => {\n      signal.removeEventListener('abort', abort);\n      resolve();\n    };\n    const abort = () => {\n      clearTimeout(timer);\n      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));\n    };\n    const timer = setTimeout(finish, milliseconds);\n    signal.addEventListener('abort', abort, { once: true });\n  });\n}`,
    'portable timeout and abortable retry delay',
  );

  source = replaceOnce(
    source,
    `      await new Promise((resolve) => setTimeout(resolve, 350 + Math.round(Math.random() * 250)));`,
    `      await abortableDelay(350 + Math.round(Math.random() * 250), req.signal);`,
    'abort-aware retry backoff',
  );

  await write('lib/llm.ts', source);
}

async function patchModelCatalog() {
  let source = await read('lib/modelCatalog.ts');
  source = replaceOnce(
    source,
    `  if (resolvedMode === 'balanced') {\n    return { models: unique([balanced, economy, best]), reason, resolvedMode };\n  }`,
    `  if (resolvedMode === 'balanced') {\n    const models = request.mode === 'balanced' ? unique([balanced, economy]) : unique([balanced, economy, best]);\n    return { models, reason, resolvedMode };\n  }`,
    'manual balanced route cost ceiling',
  );
  await write('lib/modelCatalog.ts', source);
}

async function writeWriterIntegrity() {
  const content = String.raw`import { type WriterAction } from './aiWriterPrompt';

export type WriterIntegrityKind = 'url' | 'email' | 'phone' | 'number' | 'date' | 'negation';

export interface WriterIntegrityIssue {
  kind: WriterIntegrityKind;
  value: string;
  message: string;
}

const PRESERVE_ACTIONS = new Set<WriterAction>([
  'improve', 'grammar', 'rewrite', 'shorten', 'expand', 'simplify',
  'professional', 'casual', 'humanize', 'persuasive',
]);

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]\d{4}(?!\d)/g;
const DATE_PATTERN = /\b(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])[-/.](?:(?:19|20)?\d{2}))\b/gi;
const NUMBER_PATTERN = /(?:[$€£]\s*)?\b\d[\d,.]*(?:%|\b)/g;
const NEGATION_PATTERN = /\b(?:no|not|never|without|cannot|can['’]t|won['’]t|don['’]t|doesn['’]t|didn['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\b/gi;

function uniqueValues(text: string, pattern: RegExp): string[] {
  return [...new Set((text.match(pattern) ?? []).map((value) => value.trim()).filter(Boolean))];
}

function matchCount(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function missing(original: string[], output: string[]): string[] {
  const normalized = new Set(output.map((value) => value.toLocaleLowerCase()));
  return original.filter((value) => !normalized.has(value.toLocaleLowerCase()));
}

function maskStructuredValues(text: string): string {
  return text
    .replace(URL_PATTERN, ' ')
    .replace(EMAIL_PATTERN, ' ')
    .replace(PHONE_PATTERN, ' ')
    .replace(DATE_PATTERN, ' ');
}

export function checkWriterIntegrity(original: string, output: string, action: WriterAction): WriterIntegrityIssue[] {
  if (!PRESERVE_ACTIONS.has(action) || !original.trim() || !output.trim()) return [];

  const checks: Array<{ kind: WriterIntegrityKind; pattern: RegExp; label: string }> = [
    { kind: 'url', pattern: URL_PATTERN, label: 'link' },
    { kind: 'email', pattern: EMAIL_PATTERN, label: 'email address' },
    { kind: 'phone', pattern: PHONE_PATTERN, label: 'phone number' },
    { kind: 'date', pattern: DATE_PATTERN, label: 'date' },
  ];

  const issues: WriterIntegrityIssue[] = [];
  for (const check of checks) {
    const before = uniqueValues(original, check.pattern);
    const after = uniqueValues(output, check.pattern);
    for (const value of missing(before, after)) {
      issues.push({
        kind: check.kind,
        value,
        message: 'The rewrite removed or changed the ' + check.label + ' “' + value + '”.',
      });
    }
  }

  const beforeNumbers = uniqueValues(maskStructuredValues(original), NUMBER_PATTERN);
  const afterNumbers = uniqueValues(maskStructuredValues(output), NUMBER_PATTERN);
  for (const value of missing(beforeNumbers, afterNumbers)) {
    issues.push({
      kind: 'number',
      value,
      message: 'The rewrite removed or changed the number “' + value + '”.',
    });
  }

  const beforeNegations = matchCount(original, NEGATION_PATTERN);
  const afterNegations = matchCount(output, NEGATION_PATTERN);
  if (beforeNegations !== afterNegations) {
    issues.push({
      kind: 'negation',
      value: String(beforeNegations),
      message: 'The rewrite changed negative wording, which may reverse the meaning.',
    });
  }

  return issues.slice(0, 12);
}
`;
  await write('lib/writerIntegrity.ts', content);
}

async function writeTests() {
  const content = String.raw`import assert from 'node:assert/strict';
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

test('release metadata is 8.15.1', async () => {
  const pkg = JSON.parse(await source('package.json'));
  const config = await source('wxt.config.ts');
  const lock = JSON.parse(await source('package-lock.json'));
  assert.equal(pkg.version, '8.15.1');
  assert.match(config, /version: '8\.15\.1'/);
  assert.equal(lock.version, '8.15.1');
  assert.equal(lock.packages[''].version, '8.15.1');
});
`;
  await write('scripts/test-ai-polish-8151.mjs', content);
}

async function bumpVersionAndTests() {
  const pkg = JSON.parse(await read('package.json'));
  pkg.version = '8.15.1';
  pkg.scripts['test:ai-polish-8151'] = 'node --test scripts/test-ai-polish-8151.mjs';
  if (!pkg.scripts.test.includes('test:ai-polish-8151')) pkg.scripts.test += ' && npm run test:ai-polish-8151';
  await write('package.json', JSON.stringify(pkg, null, 2) + '\n');

  const lock = JSON.parse(await read('package-lock.json'));
  lock.version = '8.15.1';
  if (lock.packages?.['']) lock.packages[''].version = '8.15.1';
  await write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

  let config = await read('wxt.config.ts');
  config = replaceOnce(config, `version: '8.15.0'`, `version: '8.15.1'`, 'manifest version');
  await write('wxt.config.ts', config);
}

await patchAiWriter();
await patchLlm();
await patchModelCatalog();
await writeWriterIntegrity();
await writeTests();
await bumpVersionAndTests();
await rm(fileUrl('scripts/apply-8151-ai-polish.mjs'), { force: true });
await rm(fileUrl('.github/workflows/keepsake-8151-ai-polish.yml'), { force: true });
console.log('Applied Keepsake 8.15.1 AI micro-polish release.');
