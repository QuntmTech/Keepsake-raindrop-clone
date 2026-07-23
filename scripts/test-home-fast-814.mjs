import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('hosted auth exposes a fast local mirror before backend initialization', async () => {
  const auth = await source('lib/auth.ts');
  assert.match(auth, /readCachedAuthUser/);
  assert.match(auth, /local:pb_auth/);
  assert.match(auth, /tokenIsFresh/);
  assert.match(auth, /readVerifiedAuthState/);
});

test('useAuth paints cached state and then verifies it', async () => {
  const hook = await source('hooks/useAuth.ts');
  assert.match(hook, /await readCachedAuthUser\(\)/);
  assert.match(hook, /mark\('ready:cache'\)/);
  assert.match(hook, /await readVerifiedAuthState\(\)/);
  assert.match(hook, /finally/);
  assert.match(hook, /await clearSnapshot\(\)/);
});

test('collection cache remains matched to the cached user id', async () => {
  const [collections, cache] = await Promise.all([
    source('hooks/useCollections.ts'),
    source('lib/cache.ts'),
  ]);
  assert.match(collections, /readCachedAuthUser/);
  assert.match(collections, /readSnapshot\(cachedUser\?\.id \?\? null\)/);
  assert.doesNotMatch(collections, /currentUser/);
  assert.match(cache, /snapshot\.uid === uid/);
});
