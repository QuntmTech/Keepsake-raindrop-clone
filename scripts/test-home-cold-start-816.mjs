import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../entrypoints/newtab/App.tsx', import.meta.url), 'utf8');
const apps = readFileSync(new URL('../lib/apps.ts', import.meta.url), 'utf8');
const appUrl = readFileSync(new URL('../lib/appUrl.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../hooks/useAuth.ts', import.meta.url), 'utf8');
const collections = readFileSync(new URL('../hooks/useCollections.ts', import.meta.url), 'utf8');

test('Home does not import the app catalog to normalize URLs', () => {
  assert.match(app, /normUrl.*@\/lib\/appUrl/);
  assert.doesNotMatch(app, /normUrl.*@\/lib\/apps/);
  assert.match(appUrl, /export function normUrl/);
  assert.match(apps, /suggested-apps\.json/);
});

test('click-only and below-fold Home surfaces are lazy', () => {
  for (const name of ['AppCatalog', 'AddDialog', 'EditDialog', 'Tour', 'DashboardWidgets', 'WatchingStrip']) {
    assert.ok(app.includes(`const ${name} = lazy(`), `${name} must be lazy-loaded`);
  }
  assert.match(app, /requestIdleCallback/);
  assert.match(app, /extrasReady && results === null/);
  assert.match(app, /<Suspense fallback=\{null\}>/);
});

test('cached user id is reused instead of constructing the backend again', () => {
  assert.match(auth, /return \{ ready, authed, id, email/);
  assert.match(app, /id: userId/);
  assert.match(app, /readSnapshot\(userId\)/);
  assert.doesNotMatch(app, /currentUser\(\)/);
  assert.match(collections, /deferCounts/);
  assert.match(collections, /countByCollection\(\)[\s\S]*650/);
});
