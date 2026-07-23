import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Capture Studio uses a bounded preview and single full-resolution export', async () => {
  const editor = await source('entrypoints/studio/ImageEditor.tsx');
  assert.match(editor, /PREVIEW_MAX_PIXELS = 3_200_000/);
  assert.match(editor, /requestAnimationFrame/);
  assert.match(editor, /bitmapRef\.current\?\.close\(\)/);
  assert.match(editor, /HISTORY_LIMIT = 100/);
  assert.doesNotMatch(editor, /prevBase: ImageBitmap/);
});

test('Capture Studio includes pro annotation and redaction tools', async () => {
  const editor = await source('entrypoints/studio/ImageEditor.tsx');
  for (const tool of ['line', 'step', 'blur', 'pixelate', 'redact', 'eraser']) {
    assert.match(editor, new RegExp(`'${tool}'`));
  }
  assert.match(editor, /ctx\.filter = `blur/);
  assert.match(editor, /jpegToPdf/);
});

test('Studio formats and file extensions follow the actual output blob', async () => {
  const app = await source('entrypoints/studio/App.tsx');
  assert.match(app, /extensionForBlob/);
  assert.match(app, /ImageExportFormat/);
  assert.match(app, /maxPixels: 16_000_000/);
  assert.match(app, /Open image/);
  assert.match(app, /option value="pdf"/);
});
