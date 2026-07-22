import { readFile, writeFile, unlink } from 'node:fs/promises';

const QUICKBAR = 'lib/quickbar.ts';
const PACKAGE = 'package.json';
const WXT = 'wxt.config.ts';
const TEST = 'scripts/test-quickbar-tooltips.mjs';
const WORKFLOW = '.github/workflows/tooltip-generator.yml';

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Ambiguous ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

let quickbar = await readFile(QUICKBAR, 'utf8');

quickbar = replaceOnce(
  quickbar,
  `    button:focus-visible, input:focus-visible, select:focus-visible, [role="button"]:focus-visible { outline: 2px solid var(--ks-accent); outline-offset: 2px; }\n    .actions { display: flex; flex-direction: column; align-items: center; gap: 3px; }`,
  `    button:focus-visible, input:focus-visible, select:focus-visible, [role="button"]:focus-visible { outline: 2px solid var(--ks-accent); outline-offset: 2px; }\n    [data-tooltip] { position: relative; }\n    [data-tooltip]::after { content: attr(data-tooltip); position: absolute; top: 50%; z-index: 2147483647;\n      width: max-content; max-width: 220px; padding: 7px 9px; border: 1px solid rgba(255,255,255,.14);\n      border-radius: 8px; background: rgba(15,17,23,.98); color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.34);\n      font: 600 11px/1.2 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; letter-spacing: .01em;\n      white-space: nowrap; pointer-events: none; opacity: 0; visibility: hidden;\n      transition: opacity .1s ease, transform .1s ease, visibility 0s linear .1s; transition-delay: 0s; }\n    .rail.right [data-tooltip]::after, .tab.right[data-tooltip]::after { right: calc(100% + 10px); left: auto; transform: translate(6px,-50%); }\n    .rail.left [data-tooltip]::after, .tab.left[data-tooltip]::after { left: calc(100% + 10px); right: auto; transform: translate(-6px,-50%); }\n    [data-tooltip]:hover::after, [data-tooltip]:focus-visible::after { opacity: 1; visibility: visible;\n      transform: translate(0,-50%); transition-delay: .08s; transition-property: opacity, transform, visibility; }\n    .rail.dragging [data-tooltip]::after, .dragging-action::after { display: none; }\n    .actions { display: flex; flex-direction: column; align-items: center; gap: 3px; }`,
  'tooltip CSS anchor',
);

quickbar = replaceOnce(
  quickbar,
  `    <button class="mini hide" type="button" aria-label="Hide Quick Bar" title="Hide Quick Bar — turn it back on in Keepsake Settings">\${icon('close')}</button>\n    <button class="mini collapse" type="button" aria-label="Collapse Quick Bar" title="Collapse to the browser edge"></button>\n    <div class="grip" role="button" aria-label="Drag Quick Bar" title="Drag up/down or across the screen to switch sides">\${icon('grip')}</div>\n    <div class="actions">\n      <button class="btn action popup" draggable="true" data-action="popup" type="button" aria-label="Open Keepsake dropdown" title="Open Keepsake dropdown">\${icon('popup')}</button>\n      <button class="btn action search" draggable="true" data-action="search" type="button" aria-label="Search Keepsake" title="Search Keepsake">\${icon('search')}</button>\n      <button class="btn action related" draggable="true" data-action="related" type="button" aria-label="Related saves" title="Related saves" hidden>\${icon('related')}</button>\n      <button class="btn action save" draggable="true" data-action="save" type="button" aria-label="Save this page" title="Save this page">\${icon('bookmark', true)}</button>\n      <button class="btn action folder" draggable="true" data-action="folder" type="button" aria-label="Save to collection" title="Save to collection">\${icon('folder')}</button>\n      <button class="btn action dash" draggable="true" data-action="dashboard" type="button" aria-label="Open Keepsake dashboard" title="Open Keepsake dashboard">\${icon('grid')}</button>\n      <button class="btn action custom" draggable="true" data-action="custom" type="button" aria-label="Open custom shortcut" title="Open custom shortcut" hidden>\${icon('link')}</button>\n    </div>\n    <button class="mini customize" type="button" aria-label="Customize Quick Bar" title="Customize Quick Bar">\${icon('settings', false, 17)}</button>`,
  `    <button class="mini hide" type="button" aria-label="Hide Quick Bar" data-tooltip="Hide Quick Bar">\${icon('close')}</button>\n    <button class="mini collapse" type="button" aria-label="Collapse Quick Bar" data-tooltip="Collapse Quick Bar"></button>\n    <div class="grip" role="button" tabindex="0" aria-label="Drag Quick Bar" data-tooltip="Drag or move sides">\${icon('grip')}</div>\n    <div class="actions">\n      <button class="btn action popup" draggable="true" data-action="popup" type="button" aria-label="Open Keepsake dropdown" data-tooltip="Open dropdown">\${icon('popup')}</button>\n      <button class="btn action search" draggable="true" data-action="search" type="button" aria-label="Search Keepsake" data-tooltip="Search Keepsake">\${icon('search')}</button>\n      <button class="btn action related" draggable="true" data-action="related" type="button" aria-label="Related saves" data-tooltip="Related saves" hidden>\${icon('related')}</button>\n      <button class="btn action save" draggable="true" data-action="save" type="button" aria-label="Save this page" data-tooltip="Save page">\${icon('bookmark', true)}</button>\n      <button class="btn action folder" draggable="true" data-action="folder" type="button" aria-label="Save to collection" data-tooltip="Choose collection">\${icon('folder')}</button>\n      <button class="btn action dash" draggable="true" data-action="dashboard" type="button" aria-label="Open Keepsake dashboard" data-tooltip="Open dashboard">\${icon('grid')}</button>\n      <button class="btn action custom" draggable="true" data-action="custom" type="button" aria-label="Open custom shortcut" data-tooltip="Open shortcut" hidden>\${icon('link')}</button>\n    </div>\n    <button class="mini customize" type="button" aria-label="Customize Quick Bar" data-tooltip="Customize Quick Bar">\${icon('settings', false, 17)}</button>`,
  'Quick Bar control markup',
);

quickbar = replaceOnce(
  quickbar,
  `  tab.title = 'Expand Keepsake Quick Bar';`,
  `  tab.setAttribute('aria-label', 'Expand Keepsake Quick Bar');\n  tab.dataset.tooltip = 'Expand Quick Bar';`,
  'collapsed tab label',
);

quickbar = replaceOnce(
  quickbar,
  `    relatedButton.innerHTML = \`\${icon('related')}<span class="count">\${Math.min(99, related.length)}</span>\`;\n    const iconName = currentSettings.quickBarCustomIcon as QuickBarCustomIcon;\n    customButton.innerHTML = icon(iconName in SVG ? iconName as keyof typeof SVG : 'link');\n    customButton.title = currentSettings.quickBarCustomLabel.trim() || 'Open custom shortcut';`,
  `    relatedButton.innerHTML = \`\${icon('related')}<span class="count">\${Math.min(99, related.length)}</span>\`;\n    relatedButton.dataset.tooltip = related.length ? \`Related saves (\${related.length})\` : 'Related saves';\n    const iconName = currentSettings.quickBarCustomIcon as QuickBarCustomIcon;\n    customButton.innerHTML = icon(iconName in SVG ? iconName as keyof typeof SVG : 'link');\n    customButton.dataset.tooltip = currentSettings.quickBarCustomLabel.trim() || 'Open shortcut';`,
  'dynamic action labels',
);

quickbar = replaceOnce(
  quickbar,
  `    saveButton.title = existingBookmark ? 'Already saved — manage saved item' : 'Save this page';`,
  `    saveButton.dataset.tooltip = existingBookmark ? 'Already saved — manage' : 'Save page';`,
  'dynamic save label',
);

await writeFile(QUICKBAR, quickbar, 'utf8');

const pkg = JSON.parse(await readFile(PACKAGE, 'utf8'));
pkg.version = '8.10.5';
pkg.scripts['test:tooltips'] = 'node --test scripts/test-quickbar-tooltips.mjs';
pkg.scripts.test = 'npm run test:retrieval && npm run test:bulk && npm run test:ui && npm run test:quickbar && npm run test:tooltips';
await writeFile(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

let wxt = await readFile(WXT, 'utf8');
wxt = replaceOnce(wxt, `version: '8.10.4'`, `version: '8.10.5'`, 'manifest version');
await writeFile(WXT, wxt, 'utf8');

await writeFile(TEST, `import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport test from 'node:test';\n\nconst source = await readFile(new URL('../lib/quickbar.ts', import.meta.url), 'utf8');\n\ntest('Quick Bar controls expose instant inward-facing labels', () => {\n  for (const label of [\n    'Open dropdown',\n    'Search Keepsake',\n    'Save page',\n    'Choose collection',\n    'Open dashboard',\n    'Customize Quick Bar',\n  ]) {\n    assert.match(source, new RegExp('data-tooltip="' + label.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\\\$&') + '"'));\n  }\n  assert.match(source, /\\[data-tooltip\\]:hover::after/);\n  assert.match(source, /\\[data-tooltip\\]:focus-visible::after/);\n  assert.match(source, /transition-delay: \\.08s/);\n  assert.match(source, /\\.rail\\.right \\[data-tooltip\\]::after/);\n  assert.match(source, /\\.rail\\.left \\[data-tooltip\\]::after/);\n});\n\ntest('dynamic labels explain duplicate, related, and custom states', () => {\n  assert.match(source, /saveButton\\.dataset\\.tooltip = existingBookmark/);\n  assert.match(source, /relatedButton\\.dataset\\.tooltip = related\\.length/);\n  assert.match(source, /customButton\\.dataset\\.tooltip = currentSettings\\.quickBarCustomLabel/);\n});\n`, 'utf8');

await unlink(WORKFLOW).catch(() => {});
await unlink(import.meta.filename).catch(() => {});
