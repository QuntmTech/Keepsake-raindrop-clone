import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Page AI stays available while the intrusive bubble is optional', async () => {
  const embed = await source('entrypoints/ai-embed.content.ts');
  assert.match(embed, /KS_AI_PAGE_GET/);
  assert.match(embed, /applySettings\(settings\.enableHighlights\)/);
  assert.match(embed, /watchSettings/);
  assert.match(embed, /disposeBubble\?\.\(\)/);
});

test('disabled selection UI creates no host and no page listeners', async () => {
  const embed = await source('entrypoints/ai-embed.content.ts');
  const settingsIndex = embed.indexOf('const settings = await getSettings()');
  const mountIndex = embed.indexOf('applySettings(settings.enableHighlights)');
  assert.ok(settingsIndex >= 0 && mountIndex > settingsIndex);
  assert.match(embed, /if \(enabled\) mountBubble\(\)/);
});
