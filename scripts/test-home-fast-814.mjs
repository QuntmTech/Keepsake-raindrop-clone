import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('hosted auth exposes a fast local mirror before backend initialization', async () => {
  const auth = await source('lib/auth.ts');
  assert.match(auth, /readCachedAuthUser/);
  assert.match(auth, /local:pb_auth/);
  assert.match(auth, /tokenIsFresh/);
  assert.match(auth, /if \(cached\) return cached/);
});

test('useAuth paints the cached signed-in shell before reconciliation', async () => {
  const hook = await source('hooks/useAuth.ts');
  assert.match(hook, /await readCachedAuthUser\(\)/);
  assert.match(hook, /mark\('ready:cache'\)/);
  assert.match(hook, /await loadAuth\(\)/);
  assert.match(hook, /finally/);
});

test('collections hydrate from the local snapshot without a user lookup', async () => {
  const [collections, cache] = await Promise.all([
    source('hooks/useCollections.ts'),
    source('lib/cache.ts'),
  ]);
  assert.match(collections, /readLastSnapshot/);
  assert.doesNotMatch(collections, /currentUser/);
  assert.match(cache, /export async function readLastSnapshot/);
});
