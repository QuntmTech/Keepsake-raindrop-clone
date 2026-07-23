import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../entrypoints/studio/ImageEditor.tsx', import.meta.url);
const source = await readFile(path, 'utf8');
const before = `  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    chunks.push(bytes);
    length += bytes.length;
  };
`;
const after = `  const chunks: ArrayBuffer[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    chunks.push(copy.buffer);
    length += copy.byteLength;
  };
`;

if (source.includes(after)) {
  console.log('PDF byte buffers already normalized.');
} else if (source.includes(before)) {
  await writeFile(path, source.replace(before, after), 'utf8');
  console.log('Normalized PDF byte buffers.');
} else {
  throw new Error('ImageEditor PDF byte-buffer block changed unexpectedly.');
}
