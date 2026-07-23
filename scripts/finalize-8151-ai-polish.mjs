import { readFile, writeFile, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const testUrl = new URL('scripts/test-ai-reliability-815.mjs', root);
let source = await readFile(testUrl, 'utf8');
const before = "  assert.equal(pkg.version, '8.15.0');";
const after = "  assert.equal(pkg.version, '8.15.1');";
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`Expected one 8.15 version assertion, found ${count}`);
source = source.replace(before, after);
await writeFile(testUrl, source, 'utf8');
await rm(new URL('scripts/finalize-8151-ai-polish.mjs', root), { force: true });
console.log('Updated the existing reliability version assertion for 8.15.1.');
