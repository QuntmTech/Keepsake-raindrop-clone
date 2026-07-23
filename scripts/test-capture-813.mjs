import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

async function loadTs(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
    fileName: path,
  });
  const errors = (compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
  const file = join(tmpdir(), `keepsake-capture-${process.pid}-${Date.now()}-${Math.random()}.mjs`);
  await writeFile(file, compiled.outputText, 'utf8');
  return import(pathToFileURL(file).href);
}

const captureSource = await readFile(new URL('../lib/capture.ts', import.meta.url), 'utf8');
const fullPageSource = await readFile(new URL('../lib/fullpage.ts', import.meta.url), 'utf8');
const menuSource = await readFile(new URL('../components/CaptureMenu.tsx', import.meta.url), 'utf8');
const backgroundSource = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const offscreenSource = await readFile(new URL('../entrypoints/offscreen/main.ts', import.meta.url), 'utf8');

test('recording profiles scale quality and bitrate', async () => {
  const { resolveRecordProfile } = await loadTs('lib/capture.ts');
  const hd = resolveRecordProfile('1080p', 30);
  const ultra = resolveRecordProfile('4k', 60);
  assert.deepEqual([hd.width, hd.height, hd.fps], [1920, 1080, 30]);
  assert.deepEqual([ultra.width, ultra.height, ultra.fps], [3840, 2160, 60]);
  assert.ok(ultra.bitrate > hd.bitrate);
  assert.ok(ultra.bitrate <= 38_000_000);
});

test('recording state migration adds pause and quality fields', async () => {
  const { normalizeRecordingState } = await loadTs('lib/capture.ts');
  const state = normalizeRecordingState({ isRecording: true, startedAt: 123, mode: 'tab', tabId: 7 });
  assert.equal(state.paused, false);
  assert.equal(state.pausedDurationMs, 0);
  assert.equal(state.quality, null);
});

test('full-page capture preserves large fixed app shells', () => {
  assert.match(fullPageSource, /Preserve app shells, preview panes/);
  assert.match(fullPageSource, /element\.querySelector\('iframe,video,canvas'\)/);
  assert.match(fullPageSource, /findTarget/);
  assert.match(fullPageSource, /overflow:auto pane/);
  assert.match(fullPageSource, /Chrome captured an empty first frame/);
});

test('Capture menu exposes region, element, UHD, pause and resume', () => {
  for (const text of ['Select an area', 'Pick an element', '4K Ultra HD', 'Pause recording', 'Resume recording']) {
    assert.ok(menuSource.includes(text), `missing ${text}`);
  }
});

test('background validates screenshots before opening Studio', () => {
  assert.match(backgroundSource, /captureValidatedPng/);
  assert.match(backgroundSource, /OFFSCREEN_ANALYZE_IMAGE/);
  assert.match(backgroundSource, /KS_CAPTURE_REGION/);
  assert.match(backgroundSource, /activeFullCaptures/);
});

test('offscreen runtime crops images and preserves tab audio', () => {
  assert.match(offscreenSource, /cropImageDataUrl/);
  assert.match(offscreenSource, /analyzeImageDataUrl/);
  assert.match(offscreenSource, /systemSource\.connect\(audioContext\.destination\)/);
  assert.match(offscreenSource, /resolveRecordProfile/);
});

test('capture contracts include all new messages', () => {
  for (const token of ['KS_CAPTURE_REGION', 'KS_PAUSE_RECORDING', 'KS_RESUME_RECORDING', 'OFFSCREEN_CROP_IMAGE', 'OFFSCREEN_ANALYZE_IMAGE']) {
    assert.ok(captureSource.includes(token), `missing ${token}`);
  }
});
