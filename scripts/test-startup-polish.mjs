import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const popup = await readFile(new URL('../entrypoints/popup/App.tsx', import.meta.url), 'utf8');
const home = await readFile(new URL('../entrypoints/newtab/App.tsx', import.meta.url), 'utf8');
const auth = await readFile(new URL('../hooks/useAuth.ts', import.meta.url), 'utf8');

test('browser startup defers durable maintenance behind first paint', () => {
  assert.match(background, /MAINTENANCE_ALARM/);
  assert.match(background, /delayInMinutes: 0\.5/);
  assert.doesNotMatch(background, /onStartup[\s\S]{0,500}await flushQueue/);
});

test('navigation intelligence is coalesced per tab', () => {
  assert.match(background, /pageIntelligenceTimers/);
  assert.match(background, /schedulePageIntelligence/);
  assert.match(background, /clearTimeout\(previous\)/);
});

test('popup and Home debounce storage/query bursts', () => {
  assert.match(popup, /query\.trim\(\) \? 120 : 20/);
  assert.match(popup, /setTimeout\(\(\) => \{[\s\S]*refreshMeta/);
  assert.match(home, /vaultTimer/);
  assert.match(home, /overlayTimer/);
});

test('auth state reads resolve concurrently after initialization', () => {
  assert.match(auth, /Promise\.all\(\[isLoggedIn\(\), currentUser\(\)\]\)/);
});
