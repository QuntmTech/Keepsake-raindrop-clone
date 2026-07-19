import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const config = await readFile(new URL('../wxt.config.ts', import.meta.url), 'utf8');
const match = config.match(/\bversion:\s*['"]([^'"]+)['"]/);

if (!match) {
  console.error('Could not find manifest version in wxt.config.ts');
  process.exit(1);
}

const manifestVersion = match[1];
if (pkg.version !== manifestVersion) {
  console.error(`Version mismatch: package.json=${pkg.version}, wxt.config.ts=${manifestVersion}`);
  process.exit(1);
}

console.log(`Version check passed: ${pkg.version}`);
