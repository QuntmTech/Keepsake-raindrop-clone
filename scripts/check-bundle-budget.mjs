import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = '.output/chrome-mv3';
const bytes = async (path) => (await stat(path)).size;
const contentDir = join(root, 'content-scripts');
const contentFiles = (await readdir(contentDir)).filter((name) => name.endsWith('.js'));
const contentSizes = await Promise.all(contentFiles.map(async (name) => [name, await bytes(join(contentDir, name))]));
const contentTotal = contentSizes.reduce((sum, [, size]) => sum + size, 0);
const background = await bytes(join(root, 'background.js'));

const limits = {
  allPageScripts: 100_000,
  background: 285_000,
};

for (const [name, size] of contentSizes) console.log(`${name}: ${size.toLocaleString()} bytes`);
console.log(`All-page content scripts: ${contentTotal.toLocaleString()} / ${limits.allPageScripts.toLocaleString()} bytes`);
console.log(`Background: ${background.toLocaleString()} / ${limits.background.toLocaleString()} bytes`);

if (contentTotal > limits.allPageScripts) throw new Error(`All-page content scripts exceed ${limits.allPageScripts} bytes`);
if (background > limits.background) throw new Error(`Background exceeds ${limits.background} bytes`);
