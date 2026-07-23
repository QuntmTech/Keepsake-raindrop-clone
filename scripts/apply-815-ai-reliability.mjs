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

function replaceRegex(source, pattern, after, label) {
  if (typeof after === 'string' && source.includes(after)) return source;
  const matches = source.match(pattern);
  if (!matches) throw new Error(`${label}: pattern not found`);
  return source.replace(pattern, after);
}

// First turn the 8.14 build-time patches into normal committed source.
await import('./apply-814-source-patches.mjs');

// ── Version and scripts ──────────────────────────────────────────────────────
const packagePath = 'package.json';
const pkg = JSON.parse(await read(packagePath));
pkg.version = '8.15.0';
for (const key of ['pretest', 'prebuild', 'precompile', 'prezip:store']) delete pkg.scripts[key];
pkg.scripts['test:ai-815'] = 'node --test scripts/test-ai-reliability-815.mjs';
if (!pkg.scripts.test.includes('test:ai-815')) pkg.scripts.test += ' && npm run test:ai-815';
await write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

try {
  const lock = JSON.parse(await read('package-lock.json'));
  lock.version = '8.15.0';
  if (lock.packages?.['']) lock.packages[''].version = '8.15.0';
  await write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

let wxt = await read('wxt.config.ts');
wxt = replaceRegex(wxt, /version:\s*'8\.14\.0'/, "version: '8.15.0'", 'wxt version');
await write('wxt.config.ts', wxt);

// ── Separate selection-AI privacy controls ───────────────────────────────────
let types = await read('lib/types.ts');
types = replaceOnce(
  types,
  '  enableHighlights: boolean;\n  enableAutoScreenshot: boolean;',
  '  enableHighlights: boolean;\n  enableAiSelectionTools: boolean; // show the AI chip only for an explicit text selection\n  aiSensitiveSiteBlocklist: string[]; // domains where the selection chip never mounts\n  enableAutoScreenshot: boolean;',
  'settings AI fields',
);
types = replaceOnce(
  types,
  '  enableHighlights: true,\n  enableAutoScreenshot: true,',
  "  enableHighlights: true,\n  enableAiSelectionTools: true,\n  aiSensitiveSiteBlocklist: [],\n  enableAutoScreenshot: true,",
  'settings AI defaults',
);
await write('lib/types.ts', types);

let settingsPanel = await read('components/SettingsPanel.tsx');
settingsPanel = replaceOnce(
  settingsPanel,
  '        <Toggle label="Highlights & annotations on pages" checked={settings.enableHighlights} onChange={(v) => update({ enableHighlights: v })} />',
  `        <Toggle label="Highlights & annotations on pages" checked={settings.enableHighlights} onChange={(v) => update({ enableHighlights: v })} />
        <Toggle label="AI Writer chip (only after I select text)" checked={settings.enableAiSelectionTools} onChange={(v) => update({ enableAiSelectionTools: v })} />
        {settings.enableAiSelectionTools && (
          <>
            <label className="mt-2 block text-xs font-medium text-ink-soft">Never show the AI chip on these sites (one domain per line)</label>
            <textarea
              className="input mt-1 h-20 font-mono text-xs"
              placeholder={'mybank.com\\nhealthportal.com'}
              defaultValue={settings.aiSensitiveSiteBlocklist.join('\\n')}
              onBlur={(event) => update({
                aiSensitiveSiteBlocklist: event.target.value
                  .split('\\n')
                  .map((domain) => domain.trim().toLowerCase())
                  .filter(Boolean),
              })}
            />
          </>
        )}`,
  'settings AI selection controls',
);
await write('components/SettingsPanel.tsx', settingsPanel);

let embed = await read('entrypoints/ai-embed.content.ts');
embed = replaceOnce(
  embed,
  `    const selected = end > start;
    const text = selected ? active.value.slice(start, end) : active.value;
    if (!text.trim()) return null;
    return { text: text.slice(0, 48_000), rect: active.getBoundingClientRect(), selected };`,
  `    if (end <= start) return null;
    const text = active.value.slice(start, end);
    if (!text.trim()) return null;
    return { text: text.slice(0, 48_000), rect: active.getBoundingClientRect(), selected: true };`,
  'input selected-text-only behavior',
);
embed = replaceOnce(
  embed,
  `  const editable = active instanceof HTMLElement
    ? active.closest<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]')
    : null;
  const text = editable?.innerText?.trim();
  return editable && text ? { text: text.slice(0, 48_000), rect: editable.getBoundingClientRect(), selected: false } : null;`,
  `  return null;`,
  'contenteditable selected-text-only behavior',
);
embed = replaceOnce(
  embed,
  `function pageText(max = 90_000): string {`,
  `function isBlockedDomain(blocklist: string[]): boolean {
  const hostname = location.hostname.toLowerCase().replace(/^www\\./, '');
  return blocklist.some((raw) => {
    const domain = raw.trim().toLowerCase().replace(/^https?:\\/\\//, '').replace(/^www\\./, '').split('/')[0];
    return Boolean(domain) && (hostname === domain || hostname.endsWith(\`.\${domain}\`));
  });
}

function pageText(max = 90_000): string {`,
  'sensitive-domain helper',
);
embed = replaceOnce(
  embed,
  `    const settings = await getSettings();
    applySettings(settings.enableHighlights);
    const unwatch = watchSettings((next) => applySettings(next.enableHighlights));`,
  `    const settings = await getSettings();
    applySettings(settings.enableAiSelectionTools && !isBlockedDomain(settings.aiSensitiveSiteBlocklist));
    const unwatch = watchSettings((next) =>
      applySettings(next.enableAiSelectionTools && !isBlockedDomain(next.aiSensitiveSiteBlocklist)),
    );`,
  'selection AI setting wiring',
);
await write('entrypoints/ai-embed.content.ts', embed);

// ── One deadline, explicit cancel, and predictable cost routing ──────────────
let llm = await read('lib/llm.ts');
llm = replaceOnce(
  llm,
  `  responseFormat?: 'text' | 'json';
}`,
  `  responseFormat?: 'text' | 'json';
  signal?: AbortSignal;
  deadlineMs?: number;
  allowFallback?: boolean;
}`,
  'LLM request cancellation fields',
);
llm = replaceOnce(
  llm,
  `const REQUEST_TIMEOUT_MS = 55_000;`,
  `const REQUEST_TIMEOUT_MS = 45_000;`,
  'request timeout',
);
llm = replaceOnce(
  llm,
  `function requestSignal(timeout = REQUEST_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeout);
}`,
  `function requestSignal(timeout = REQUEST_TIMEOUT_MS, external?: AbortSignal): AbortSignal {
  const bounded = AbortSignal.timeout(Math.max(1, Math.min(timeout, 120_000)));
  return external ? AbortSignal.any([external, bounded]) : bounded;
}`,
  'combined request signal',
);
llm = llm.replaceAll('signal: requestSignal(),', 'signal: requestSignal(req.deadlineMs ?? REQUEST_TIMEOUT_MS, req.signal),');
llm = replaceOnce(
  llm,
  `function readableError(error: unknown): Error {
  const name = (error as { name?: string })?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return new Error('The AI request timed out — try again.');
  if (error instanceof TypeError) return new Error('Could not reach the AI provider. Check your connection and try again.');
  return error instanceof Error ? error : new Error('The AI request failed.');
}`,
  `function readableError(error: unknown): Error {
  const name = (error as { name?: string })?.name;
  if (name === 'AbortError') {
    const cancelled = new Error('AI request cancelled.');
    cancelled.name = 'AbortError';
    return cancelled;
  }
  if (name === 'TimeoutError') return new Error('The AI request reached its time limit — try again.');
  if (error instanceof TypeError) return new Error('Could not reach the AI provider. Check your connection and try again.');
  return error instanceof Error ? error : new Error('The AI request failed.');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Cancelled', 'AbortError');
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const cancel = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}`,
  'readable cancellation errors',
);
llm = replaceOnce(
  llm,
  `  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await adapter(key, model, req);
    } catch (error) {
      last = error;
      if (!transient(error) || attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 350 + Math.round(Math.random() * 250)));
    }
  }`,
  `  for (let attempt = 0; attempt < 2; attempt++) {
    throwIfAborted(req.signal);
    try {
      return await adapter(key, model, req);
    } catch (error) {
      last = error;
      throwIfAborted(req.signal);
      if (!transient(error) || attempt === 1) throw error;
      await abortableDelay(350 + Math.round(Math.random() * 250), req.signal);
    }
  }`,
  'abortable retry loop',
);
llm = replaceOnce(
  llm,
  `    return { models: route.models, routeReason: route.reason };`,
  `    const mode = req.routeMode ?? settings.routeMode ?? 'auto';
    const permitFallback = req.allowFallback !== false && mode === 'auto';
    return { models: permitFallback ? route.models : route.models.slice(0, 1), routeReason: route.reason };`,
  'manual route fallback guard',
);
llm = replaceRegex(
  llm,
  /export async function llmCompleteDetailed\(req: LlmRequest\): Promise<LlmResult> \{[\s\S]*?\n\}\n\nexport async function llmComplete\(/,
  `export async function llmCompleteDetailed(req: LlmRequest): Promise<LlmResult> {
  const settings = await getAiSettings();
  if (!settings.enabled || !settings.apiKey.trim()) throw new Error('No API key configured');
  const provider = (settings.provider ?? 'novita') as LlmProvider;
  const deadlineMs = Math.max(5_000, Math.min(req.deadlineMs ?? REQUEST_TIMEOUT_MS, 120_000));
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadlineController.abort(new DOMException('The AI request reached its time limit.', 'TimeoutError')),
    deadlineMs,
  );
  const signal = req.signal ? AbortSignal.any([req.signal, deadlineController.signal]) : deadlineController.signal;
  const boundedRequest: LlmRequest = { ...req, signal, deadlineMs };
  const { models, routeReason } = modelsForRequest(provider, settings, boundedRequest);
  const startedAt = performance.now();
  let lastError: unknown;

  try {
    for (let index = 0; index < models.length; index++) {
      throwIfAborted(signal);
      const model = models[index];
      try {
        const result = await callWithRetry(ADAPTERS[provider], settings.apiKey.trim(), model, boundedRequest);
        const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
        return {
          text: result.text,
          provider,
          model,
          latencyMs,
          usage: result.usage,
          estimatedCostUsd: provider === 'novita' ? estimateModelCostUsd(model, result.usage) : undefined,
          routeReason,
          fallbackCount: index,
        };
      } catch (error) {
        lastError = error;
        throwIfAborted(signal);
        if (!canTryAnotherModel(error) || index === models.length - 1) break;
      }
    }
    throw readableError(lastError);
  } catch (error) {
    throw readableError(error);
  } finally {
    clearTimeout(deadlineTimer);
  }
}

export async function llmComplete(`,
  'bounded LLM completion',
);
await write('lib/llm.ts', llm);

let writerLib = await read('lib/aiWriter.ts');
writerLib = replaceOnce(
  writerLib,
  `export async function runWriterDetailed(request: WriterRequest & { quality?: AiRouteMode }): Promise<LlmResult> {`,
  `export async function runWriterDetailed(
  request: WriterRequest & { quality?: AiRouteMode; signal?: AbortSignal },
): Promise<LlmResult> {`,
  'writer cancellation signature',
);
writerLib = replaceOnce(
  writerLib,
  `    temperature: request.action === 'grammar' || request.action === 'translate' ? 0.15 : 0.45,
  });`,
  `    temperature: request.action === 'grammar' || request.action === 'translate' ? 0.15 : 0.45,
    signal: request.signal,
    deadlineMs: 45_000,
  });`,
  'writer deadline wiring',
);
await write('lib/aiWriter.ts', writerLib);

let writerPrompt = await read('lib/aiWriterPrompt.ts');
writerPrompt = replaceOnce(
  writerPrompt,
  `  const custom = normalizeWriterText(request.customInstruction ?? '', 1200);`,
  `  const custom = normalizeWriterText(request.customInstruction ?? '', 4000);`,
  'custom prompt length',
);
await write('lib/aiWriterPrompt.ts', writerPrompt);

let writerUi = await read('components/AIWriter.tsx');
writerUi = replaceOnce(
  writerUi,
  `  const requestId = useRef(0);
  const mounted = useRef(false);`,
  `  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(false);`,
  'writer abort ref',
);
writerUi = replaceOnce(
  writerUi,
  `      cancelled = true;
      mounted.current = false;`,
  `      cancelled = true;
      abortRef.current?.abort(new DOMException('Cancelled', 'AbortError'));
      abortRef.current = null;
      mounted.current = false;`,
  'writer unmount cancellation',
);
writerUi = replaceOnce(
  writerUi,
  `    const id = ++requestId.current;
    setBusy(true);`,
  `    const id = ++requestId.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);`,
  'writer request controller',
);
writerUi = replaceOnce(
  writerUi,
  `        quality: draft.quality,
      });`,
  `        quality: draft.quality,
        signal: controller.signal,
      });`,
  'writer signal pass-through',
);
writerUi = replaceOnce(
  writerUi,
  `    } catch (cause) {
      if (id !== requestId.current) return;
      setError(cause instanceof Error ? cause.message : 'AI Writer failed. Try again.');
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }`,
  `    } catch (cause) {
      if (id !== requestId.current) return;
      if ((cause as { name?: string })?.name === 'AbortError') setStatus('AI request cancelled.');
      else setError(cause instanceof Error ? cause.message : 'AI Writer failed. Try again.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (id === requestId.current) setBusy(false);
    }
  }

  function cancelGeneration() {
    if (!abortRef.current) return;
    requestId.current += 1;
    abortRef.current.abort(new DOMException('Cancelled', 'AbortError'));
    abortRef.current = null;
    setBusy(false);
    setError('');
    setStatus('AI request cancelled.');
  }`,
  'writer cancel handler',
);
writerUi = replaceOnce(
  writerUi,
  `            maxLength={1200}`,
  `            maxLength={4000}`,
  'writer prompt UI length',
);
writerUi = replaceOnce(
  writerUi,
  `        <button className="btn-primary w-full justify-center" onClick={() => generate()} disabled={busy || !draft.input.trim()}>
          {busy ? 'Writing…' : \`${writerActionLabel(draft.action)} →\`}
        </button>`,
  `        <button
          className={busy ? 'btn-outline w-full justify-center border-red-500/40 text-red-500' : 'btn-primary w-full justify-center'}
          onClick={busy ? cancelGeneration : () => generate()}
          disabled={!busy && !draft.input.trim()}
        >
          {busy ? 'Cancel request' : \`${writerActionLabel(draft.action)} →\`}
        </button>`,
  'writer cancel button',
);
await write('components/AIWriter.tsx', writerUi);

// ── Patch-based selection replacement and undo ───────────────────────────────
let content = await read('entrypoints/content.ts');
content = replaceOnce(
  content,
  `type SelectionUndo =
  | { kind: 'input'; element: TextInput; value: string; start: number; end: number }
  | { kind: 'contenteditable'; inserted: Text; original: string; root: HTMLElement };`,
  `type SelectionUndo =
  | { kind: 'input'; element: TextInput; start: number; original: string; replacement: string }
  | { kind: 'contenteditable'; node: Text; start: number; original: string; replacement: string; root: HTMLElement };`,
  'selection undo type',
);
content = replaceOnce(
  content,
  `    selectionUndo = { kind: 'input', element, value: element.value, start, end };`,
  `    selectionUndo = { kind: 'input', element, start, original: selected.text, replacement: text };`,
  'input patch undo capture',
);
content = replaceOnce(
  content,
  `  selectionUndo = null;
  range.deleteContents();
  const inserted = document.createTextNode(text);
  range.insertNode(inserted);
  selectionUndo = { kind: 'contenteditable', inserted, original: selected.text, root };
  const nextRange = document.createRange();
  nextRange.selectNodeContents(inserted);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  dispatchTextInput(root, text, 'insertReplacementText');
  capturedSelection = { kind: 'contenteditable', root, range: nextRange.cloneRange(), text };
  return { ok: true, undoAvailable: true };`,
  `  if (range.startContainer !== range.endContainer || !(range.startContainer instanceof Text)) {
    return {
      ok: false,
      error: 'This selection crosses formatted elements. Use Copy, or select text inside one formatting block to replace it safely.',
    };
  }
  const node = range.startContainer;
  const start = range.startOffset;
  const end = range.endOffset;
  if (node.data.slice(start, end) !== selected.text) {
    return { ok: false, error: 'The editable text changed. Select it again.' };
  }
  node.replaceData(start, end - start, text);
  selectionUndo = { kind: 'contenteditable', node, start, original: selected.text, replacement: text, root };
  const nextRange = document.createRange();
  nextRange.setStart(node, start);
  nextRange.setEnd(node, start + text.length);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  dispatchTextInput(root, text, 'insertReplacementText');
  capturedSelection = { kind: 'contenteditable', root, range: nextRange.cloneRange(), text };
  return { ok: true, undoAvailable: true };`,
  'safe contenteditable replacement',
);
content = replaceOnce(
  content,
  `  if (undo.kind === 'input') {
    const { element, value, start, end } = undo;
    if (!element.isConnected) return { ok: false, error: 'The original field is no longer available.' };
    element.focus();
    element.value = value;
    element.setSelectionRange(start, end);
    dispatchTextInput(element, null, 'historyUndo');
    capturedSelection = { kind: 'input', element, start, end, text: value.slice(start, end) };
  } else {
    const { inserted, original, root } = undo;
    if (!inserted.isConnected || !root.isConnected) return { ok: false, error: 'The original text is no longer available.' };
    const restored = document.createTextNode(original);
    inserted.replaceWith(restored);
    const range = document.createRange();
    range.selectNodeContents(restored);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    dispatchTextInput(root, original, 'historyUndo');
    capturedSelection = { kind: 'contenteditable', root, range: range.cloneRange(), text: original };
  }`,
  `  if (undo.kind === 'input') {
    const { element, start, original, replacement } = undo;
    const end = start + replacement.length;
    if (!element.isConnected) return { ok: false, error: 'The original field is no longer available.' };
    if (element.value.slice(start, end) !== replacement) {
      return { ok: false, error: 'The replacement was edited, so Keepsake did not overwrite your newer changes.' };
    }
    element.focus();
    element.setRangeText(original, start, end, 'select');
    dispatchTextInput(element, original, 'historyUndo');
    capturedSelection = { kind: 'input', element, start, end: start + original.length, text: original };
  } else {
    const { node, start, original, replacement, root } = undo;
    if (!node.isConnected || !root.isConnected) return { ok: false, error: 'The original text is no longer available.' };
    if (node.data.slice(start, start + replacement.length) !== replacement) {
      return { ok: false, error: 'The replacement was edited, so Keepsake did not overwrite your newer changes.' };
    }
    node.replaceData(start, replacement.length, original);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + original.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    dispatchTextInput(root, original, 'historyUndo');
    capturedSelection = { kind: 'contenteditable', root, range: range.cloneRange(), text: original };
  }`,
  'patch-based replacement undo',
);
await write('entrypoints/content.ts', content);

// ── Regression coverage ──────────────────────────────────────────────────────
await write('scripts/test-ai-reliability-815.mjs', `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(\`../\${path}\`, import.meta.url), 'utf8');

test('build and test scripts never rewrite committed source', async () => {
  const pkg = JSON.parse(await source('package.json'));
  for (const key of ['pretest', 'prebuild', 'precompile', 'prezip:store']) assert.equal(pkg.scripts[key], undefined);
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /apply-814-source-patches/);
});

test('AI requests have one deadline, cancellation, and no manual cost escalation', async () => {
  const llm = await source('lib/llm.ts');
  assert.match(llm, /signal\?: AbortSignal/);
  assert.match(llm, /deadlineController/);
  assert.match(llm, /AbortSignal\.any/);
  assert.match(llm, /mode === 'auto'/);
  assert.match(llm, /route\.models\.slice\(0, 1\)/);
  assert.match(llm, /abortableDelay/);
});

test('Writer exposes cancel and uses the same 4000 character prompt limit as the library', async () => {
  const [ui, prompt] = await Promise.all([source('components/AIWriter.tsx'), source('lib/aiWriterPrompt.ts')]);
  assert.match(ui, /Cancel request/);
  assert.match(ui, /AbortController/);
  assert.match(ui, /maxLength=\{4000\}/);
  assert.match(prompt, /customInstruction \?\? '', 4000/);
});

test('selection AI sends only explicitly selected text and has a separate privacy toggle', async () => {
  const [embed, types, settings] = await Promise.all([
    source('entrypoints/ai-embed.content.ts'),
    source('lib/types.ts'),
    source('components/SettingsPanel.tsx'),
  ]);
  assert.match(embed, /if \(end <= start\) return null/);
  assert.match(embed, /return null;\n\}/);
  assert.match(embed, /enableAiSelectionTools/);
  assert.match(embed, /isBlockedDomain/);
  assert.match(types, /aiSensitiveSiteBlocklist/);
  assert.match(settings, /only after I select text/);
});

test('replacement undo patches only the AI span and refuses destructive formatted replacements', async () => {
  const content = await source('entrypoints/content.ts');
  assert.match(content, /setRangeText\(original, start, end, 'select'\)/);
  assert.match(content, /The replacement was edited/);
  assert.match(content, /crosses formatted elements/);
  assert.match(content, /node\.replaceData/);
  assert.doesNotMatch(content, /element\.value = value/);
});
`);

// Remove every one-shot source mutator, including this job and workflow.
for (const path of [
  'scripts/apply-814-source-patches.mjs',
  'scripts/fix-image-editor-pdf.mjs',
  'scripts/apply-815-ai-reliability.mjs',
  '.github/workflows/keepsake-815-ai-reliability.yml',
]) {
  await rm(fileUrl(path), { force: true });
}

console.log('Keepsake 8.15 AI reliability source migration applied.');
