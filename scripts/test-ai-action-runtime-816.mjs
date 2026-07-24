import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const embed = readFileSync(new URL('../entrypoints/ai-embed.content.ts', import.meta.url), 'utf8');
const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const writer = readFileSync(new URL('../components/AIWriter.tsx', import.meta.url), 'utf8');

test('selection actions send the complete command immediately', () => {
  assert.doesNotMatch(embed, /import \{ setWriterDraft \}/);
  assert.match(embed, /type: 'OPEN_AI_TOOLS',[\s\S]*text: selected\.text/);
  assert.match(embed, /action: action\.writerAction/);
  assert.match(embed, /customInstruction: action\.customInstruction \?\? ''/);
  assert.match(embed, /targetLanguage: settings\.aiSelectionTranslateLanguage/);
});

test('background opens first and never silently drops the AI workspace', () => {
  const handler = background.slice(background.indexOf("case 'OPEN_AI_TOOLS'"), background.indexOf("case 'OPEN_URL'"));
  assert.ok(handler.indexOf('const panelPromise = openSidePanel') < handler.indexOf('setWriterDraft({'));
  assert.match(handler, /customInstruction: msg\.customInstruction \?\? ''/);
  assert.match(handler, /targetLanguage: msg\.targetLanguage \?\? 'English'/);
  assert.match(handler, /browser\.runtime\.getURL\('\/sidepanel\.html'\)/);
  assert.match(background, /async function openSidePanel\(tabId\?: number\): Promise<boolean>/);
  assert.match(background, /return false;/);
});

test('missing AI setup is clearly explained', () => {
  assert.match(writer, /AI connection required/);
  assert.match(writer, /does not bundle a secret AI key/);
  assert.match(writer, /Connect AI now/);
});
