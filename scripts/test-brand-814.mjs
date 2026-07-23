import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pngSize = async (size) => {
  const bytes = await readFile(new URL(`../public/icon/${size}.png`, import.meta.url));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

test('the new Keepsake icon is present at every manifest size', async () => {
  for (const size of [16, 32, 48, 128]) {
    assert.deepEqual(await pngSize(size), { width: size, height: size });
  }
});

test('large filled brand marks use the packaged icon while save actions stay semantic', async () => {
  const icon = await readFile(new URL('../components/Icon.tsx', import.meta.url), 'utf8');
  assert.match(icon, /name === 'bookmark' && fill && size >= 17/);
  assert.match(icon, /runtime\.getURL\('\/icon\/128\.png'\)/);
});
