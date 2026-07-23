import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('selection command center exposes advanced built-in and custom actions', async () => {
  const [actions, prompt, messaging, background] = await Promise.all([
    source('lib/selectionActions.ts'),
    source('lib/aiWriterPrompt.ts'),
    source('lib/messaging.ts'),
    source('entrypoints/background.ts'),
  ]);
  for (const action of ['summarize', 'explain', 'keypoints', 'reply', 'translate']) {
    assert.match(actions, new RegExp(`id: '${action}'`));
    assert.match(prompt, new RegExp(`'${action}'`));
  }
  assert.match(actions, /customInstruction/);
  assert.match(messaging, /customInstruction\?: string/);
  assert.match(messaging, /targetLanguage\?: string/);
  assert.match(background, /customInstruction: msg\.customInstruction/);
  assert.match(background, /targetLanguage: msg\.targetLanguage/);
});

test('selection menu is configurable and can be dismissed at every requested scope', async () => {
  const [types, settingsUi, content] = await Promise.all([
    source('lib/types.ts'),
    source('components/AiSelectionSettings.tsx'),
    source('entrypoints/ai-embed.content.ts'),
  ]);
  assert.match(types, /aiSelectionActions/);
  assert.match(types, /aiSelectionCustomActions/);
  assert.match(types, /aiSelectionBlockedSites/);
  assert.match(types, /aiSelectionShowForReading/);
  assert.match(types, /aiSelectionShowForWriting/);
  assert.match(settingsUi, /Add custom action/);
  assert.match(settingsUi, /Move .* up/);
  assert.match(content, /Hide for this visit/);
  assert.match(content, /Disable on \$\{currentSite\(\)/);
  assert.match(content, /Turn off everywhere/);
  assert.match(content, /Customize actions/);
  assert.match(content, /event\.key !== 'Escape'/);
  assert.match(content, /dismissedFingerprint/);
  assert.match(content, /siteBlocked\(settings\)/);
});

test('plan contract separates hosted limits from BYOK and defines three customer plans', async () => {
  const [plans, docs, settingsUi] = await Promise.all([
    source('lib/aiPlans.ts'),
    source('docs/AI_SELECTION_AND_PLANS_816.md'),
    source('components/AiSelectionSettings.tsx'),
  ]);
  assert.match(plans, /free:/);
  assert.match(plans, /pro:/);
  assert.match(plans, /max:/);
  assert.match(plans, /dailyCredits: 15/);
  assert.match(plans, /monthlyCredits: 2_500/);
  assert.match(plans, /monthlyCredits: 10_000/);
  assert.match(docs, /BYOK requests are not capped/);
  assert.match(docs, /PocketBase remains the authoritative/);
  assert.match(settingsUi, /Hosted-AI limits do not apply when users bring their own provider key/);
});

test('8.16 source remains selected-text-only and does not capture entire fields', async () => {
  const content = await source('entrypoints/ai-embed.content.ts');
  assert.match(content, /if \(end <= start\) return null/);
  assert.match(content, /active\.value\.slice\(start, end\)/);
  assert.doesNotMatch(content, /text: active\.value[),]/);
  assert.match(content, /never send an entire field implicitly/);
});
