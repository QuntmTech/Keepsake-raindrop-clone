import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [llm, transcript, embed, writer, workbench, settings, prompts, pageTools] = await Promise.all([
  readFile(new URL('../lib/llm.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/novitaTranscription.ts', import.meta.url), 'utf8'),
  readFile(new URL('../entrypoints/ai-embed.content.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/AIWriter.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/AIWorkbench.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/AiEngineSettings.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../lib/promptLibrary.ts', import.meta.url), 'utf8'),
  readFile(new URL('../components/AIPageTools.tsx', import.meta.url), 'utf8'),
]);

test('Novita uses official OpenAI-compatible endpoints and detailed results', () => {
  assert.match(llm, /https:\/\/api\.novita\.ai\/openai\/v1\/chat\/completions/);
  assert.match(llm, /https:\/\/api\.novita\.ai\/openai\/v1\/models/);
  assert.match(llm, /llmCompleteDetailed/);
  assert.match(llm, /estimatedCostUsd/);
  assert.match(llm, /fallbackCount/);
});

test('transcription stays below Novita chunk limits and supports cancellation', () => {
  assert.match(transcript, /const CHUNK_SECONDS = 25/);
  assert.match(transcript, /https:\/\/api\.novita\.ai\/v3\/glm-asr/);
  assert.match(transcript, /AbortController|AbortSignal/);
  assert.match(transcript, /onProgress/);
});

test('embedded writing and page capture are user-triggered', () => {
  assert.match(embed, /OPEN_AI_TOOLS/);
  assert.match(embed, /KS_AI_PAGE_GET/);
  assert.match(embed, /button\.addEventListener\('click'/);
  assert.match(embed, /SOURCE|pageText/);
});

test('Writer exposes the promised daily-use actions and transparent routing', () => {
  for (const action of ['humanize', 'persuasive', 'reply', 'translate', 'custom']) {
    assert.match(writer, new RegExp(`action: '${action}'`));
  }
  assert.match(writer, /economy/);
  assert.match(writer, /balanced/);
  assert.match(writer, /AiResultMeta/);
  assert.match(writer, /findPromptBySlash/);
});

test('Workbench includes Write, Page, Audio, Prompts and Library', () => {
  for (const label of ['Write', 'Page', 'Audio', 'Prompts', 'Library']) assert.match(workbench, new RegExp(label));
});

test('Settings exposes provider testing, live models and route strategies', () => {
  assert.match(settings, /listProviderModels/);
  assert.match(settings, /Default model strategy/);
  assert.match(settings, /Model ladder/);
  assert.match(settings, /estimated cost/);
});

test('Prompt library and Page AI are fully reachable', () => {
  assert.match(prompts, /Founder update/);
  assert.match(prompts, /Natural reply/);
  assert.match(prompts, /findPromptBySlash/);
  assert.match(pageTools, /Summary/);
  assert.match(pageTools, /Ask page/);
  assert.match(pageTools, /Save/);
});
