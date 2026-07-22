import { readFile, writeFile, unlink } from 'node:fs/promises';

const QUICKBAR = 'lib/quickbar.ts';
const TYPES = 'lib/types.ts';
const CONFIG = 'lib/quickbarConfig.ts';
const CONFIG_TEST = 'scripts/test-quickbar-config.mjs';
const TOOLTIP_TEST = 'scripts/test-quickbar-tooltips.mjs';
const WORKFLOW = '.github/workflows/collection-launcher-generator.yml';

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Ambiguous ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

let types = await readFile(TYPES, 'utf8');
types = replaceOnce(
  types,
  `export type QuickBarAction = 'popup' | 'search' | 'related' | 'save' | 'folder' | 'dashboard' | 'custom';`,
  `export type QuickBarAction = 'popup' | 'search' | 'browse' | 'related' | 'save' | 'folder' | 'dashboard' | 'custom';`,
  'QuickBarAction union',
);
types = replaceOnce(
  types,
  `  quickBarOrder: ['popup', 'search', 'related', 'save', 'folder', 'dashboard', 'custom'],`,
  `  quickBarOrder: ['popup', 'search', 'browse', 'related', 'save', 'folder', 'dashboard', 'custom'],`,
  'default Quick Bar order',
);
await writeFile(TYPES, types, 'utf8');

let config = await readFile(CONFIG, 'utf8');
config = replaceOnce(
  config,
  `  'search',\n  'related',`,
  `  'search',\n  'browse',\n  'related',`,
  'default discovery actions',
);
config = replaceOnce(
  config,
  `  for (const action of ['search', 'related'] as QuickBarAction[]) {`,
  `  for (const action of ['search', 'browse', 'related'] as QuickBarAction[]) {`,
  'legacy action migration',
);
await writeFile(CONFIG, config, 'utf8');

let quickbar = await readFile(QUICKBAR, 'utf8');
quickbar = replaceOnce(
  quickbar,
  `import { listCollections, createCollection, findByUrl, searchBookmarks } from './bookmarks';`,
  `import { listCollections, createCollection, findByUrl, searchBookmarks, countByCollection } from './bookmarks';`,
  'bookmark imports',
);
quickbar = replaceOnce(
  quickbar,
  `  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',`,
  `  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',\n  library: '<path d="M4 5h6v14H4zM10 5h5v14h-5zM17 5l3-.8 2 14.8-3 .8z"/><path d="M7 9h.01M12.5 9h.01M19 9h.01"/>',`,
  'library icon',
);
quickbar = replaceOnce(
  quickbar,
  `      <button class="btn action search" draggable="true" data-action="search" type="button" aria-label="Search Keepsake" data-tooltip="Search Keepsake">\${icon('search')}</button>\n      <button class="btn action related"`,
  `      <button class="btn action search" draggable="true" data-action="search" type="button" aria-label="Search Keepsake" data-tooltip="Search Keepsake">\${icon('search')}</button>\n      <button class="btn action browse" draggable="true" data-action="browse" type="button" aria-label="Browse collections" data-tooltip="Browse collections">\${icon('library')}</button>\n      <button class="btn action related"`,
  'browse button markup',
);
quickbar = replaceOnce(
  quickbar,
  `  const searchButton = rail.querySelector('.btn.search') as HTMLButtonElement;\n  const relatedButton = rail.querySelector('.btn.related') as HTMLButtonElement;`,
  `  const searchButton = rail.querySelector('.btn.search') as HTMLButtonElement;\n  const browseButton = rail.querySelector('.btn.browse') as HTMLButtonElement;\n  const relatedButton = rail.querySelector('.btn.related') as HTMLButtonElement;`,
  'browse button query',
);
quickbar = replaceOnce(
  quickbar,
  `      popup: popupButton, search: searchButton, related: relatedButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,`,
  `      popup: popupButton, search: searchButton, browse: browseButton, related: relatedButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,`,
  'action map',
);
quickbar = replaceOnce(
  quickbar,
  `  for (const button of [popupButton, searchButton, relatedButton, saveButton, folderButton, dashboardButton, customButton]) {`,
  `  for (const button of [popupButton, searchButton, browseButton, relatedButton, saveButton, folderButton, dashboardButton, customButton]) {`,
  'draggable action list',
);
quickbar = replaceOnce(
  quickbar,
  `  async function openSearch() {`,
  `  async function openCollectionLauncher() {\n    closePopover();\n    popover = buildPopover();\n    popover.classList.add('wide');\n    const panel = popover;\n    const heading = document.createElement('h4');\n    heading.textContent = 'Browse collections';\n    const list = document.createElement('div');\n    list.innerHTML = '<div class="empty">Loading collections…</div>';\n    popover.append(heading, list);\n    shadow.appendChild(popover);\n\n    const addCollectionRow = (label: string, color: string, count: number | undefined, id?: string, unsorted = false) => {\n      const row = document.createElement('button');\n      row.type = 'button';\n      row.className = 'row';\n      const dot = document.createElement('span');\n      dot.className = 'dot';\n      dot.style.background = color;\n      const copy = document.createElement('span');\n      copy.className = 'result-copy';\n      const title = document.createElement('span');\n      title.className = 'result-title';\n      title.textContent = label;\n      const meta = document.createElement('span');\n      meta.className = 'result-meta';\n      meta.textContent = count == null ? 'Open bookmarks' : \`${count} bookmark\${count === 1 ? '' : 's'}\`;\n      copy.append(title, meta);\n      row.append(dot, copy);\n      row.onclick = () => openCollectionBookmarks(id, label, unsorted);\n      list.appendChild(row);\n    };\n\n    try {\n      const [collections, counts] = await Promise.all([loadCollections(), countByCollection()]);\n      if (popover !== panel) return;\n      list.replaceChildren();\n      addCollectionRow('All bookmarks', accent, undefined);\n      addCollectionRow('Unsorted', 'rgba(255,255,255,.35)', undefined, undefined, true);\n      for (const collection of collections) {\n        addCollectionRow(\n          \`${collection.icon ? \`${collection.icon} \` : ''}\${collection.name}\`,\n          collection.color || accent,\n          counts[collection.id] || 0,\n          collection.id,\n        );\n      }\n      if (!collections.length) {\n        const hint = document.createElement('div');\n        hint.className = 'empty';\n        hint.textContent = 'No collections yet — All bookmarks and Unsorted are still available.';\n        list.appendChild(hint);\n      }\n    } catch {\n      if (popover !== panel) return;\n      list.innerHTML = '<div class="empty">Collections could not be loaded. Try again.</div>';\n    }\n  }\n\n  async function openCollectionBookmarks(collectionId: string | undefined, label: string, unsorted = false) {\n    closePopover();\n    popover = buildPopover();\n    popover.classList.add('wide');\n    const panel = popover;\n\n    const back = document.createElement('button');\n    back.type = 'button';\n    back.className = 'row';\n    back.textContent = '← All collections';\n    back.onclick = openCollectionLauncher;\n    const heading = document.createElement('h4');\n    heading.textContent = label;\n    const input = document.createElement('input');\n    input.className = 'search-input';\n    input.type = 'search';\n    input.placeholder = \`Search \${label.toLowerCase()}…\`;\n    const results = document.createElement('div');\n    popover.append(back, heading, input, results);\n    shadow.appendChild(popover);\n\n    let timer: number | undefined;\n    let sequence = 0;\n    const run = async () => {\n      const current = ++sequence;\n      const query = input.value.trim();\n      results.innerHTML = '<div class="empty">Loading bookmarks…</div>';\n      let items = await searchBookmarks(query, {\n        collection: collectionId,\n        perPage: unsorted ? 300 : 50,\n      }).catch(() => []);\n      if (unsorted) items = items.filter((item) => !item.collection);\n      items = items.filter((item) => !item.homeOnly).slice(0, 50);\n      if (popover !== panel || current !== sequence) return;\n      addBookmarkRows(results, items, query ? 'No matching bookmarks.' : 'This collection is empty.');\n      if (items.length) {\n        const dashboard = document.createElement('button');\n        dashboard.type = 'button';\n        dashboard.className = 'row';\n        dashboard.textContent = 'Open full dashboard →';\n        dashboard.onclick = () => send({ type: 'OPEN_DASHBOARD' });\n        results.appendChild(dashboard);\n      }\n    };\n    input.addEventListener('input', () => {\n      window.clearTimeout(timer);\n      timer = window.setTimeout(run, 140);\n    });\n    input.addEventListener('keydown', (event) => {\n      if (event.key === 'Enter') (results.querySelector('button') as HTMLButtonElement | null)?.click();\n    });\n    await run();\n    input.focus();\n  }\n\n  async function openSearch() {`,
  'collection launcher functions',
);
quickbar = replaceOnce(
  quickbar,
  `      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'search', 'related', 'save', 'folder', 'dashboard', 'custom'] }));`,
  `      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'search', 'browse', 'related', 'save', 'folder', 'dashboard', 'custom'] }));`,
  'reset order',
);
quickbar = replaceOnce(
  quickbar,
  `  searchButton.onclick = openSearch;\n  relatedButton.onclick = openRelated;`,
  `  searchButton.onclick = openSearch;\n  browseButton.onclick = openCollectionLauncher;\n  relatedButton.onclick = openRelated;`,
  'browse click handler',
);
await writeFile(QUICKBAR, quickbar, 'utf8');

let configTest = await readFile(CONFIG_TEST, 'utf8');
configTest = replaceOnce(
  configTest,
  `const completeOrder = ['popup', 'search', 'related', 'save', 'folder', 'dashboard', 'custom'];`,
  `const completeOrder = ['popup', 'search', 'browse', 'related', 'save', 'folder', 'dashboard', 'custom'];`,
  'complete test order',
);
configTest = replaceOnce(
  configTest,
  `    'folder', 'popup', 'search', 'related', 'save', 'dashboard', 'custom',`,
  `    'folder', 'popup', 'search', 'browse', 'related', 'save', 'dashboard', 'custom',`,
  'legacy migration expectation',
);
configTest = replaceOnce(
  configTest,
  `    normalizeQuickBarOrder(['dashboard', 'save', 'popup', 'related', 'folder', 'search', 'custom']),\n    ['dashboard', 'save', 'popup', 'related', 'folder', 'search', 'custom'],`,
  `    normalizeQuickBarOrder(['dashboard', 'save', 'popup', 'related', 'folder', 'browse', 'search', 'custom']),\n    ['dashboard', 'save', 'popup', 'related', 'folder', 'browse', 'search', 'custom'],`,
  'custom order expectation',
);
configTest = replaceOnce(
  configTest,
  `    ['popup', 'search', 'related', 'dashboard', 'save', 'folder', 'custom'],`,
  `    ['popup', 'search', 'browse', 'related', 'dashboard', 'save', 'folder', 'custom'],`,
  'reorder expectation',
);
await writeFile(CONFIG_TEST, configTest, 'utf8');

let tooltipTest = await readFile(TOOLTIP_TEST, 'utf8');
tooltipTest = replaceOnce(
  tooltipTest,
  `    'Search Keepsake',\n    'Save page',`,
  `    'Search Keepsake',\n    'Browse collections',\n    'Save page',`,
  'tooltip label coverage',
);
tooltipTest += `\n\ntest('collection launcher opens inward with searchable bookmark drill-down', () => {\n  assert.match(source, /data-action="browse"/);\n  assert.match(source, /async function openCollectionLauncher/);\n  assert.match(source, /async function openCollectionBookmarks/);\n  assert.match(source, /countByCollection/);\n  assert.match(source, /Search \\${label\\.toLowerCase\\(\\)}/);\n});\n`;
await writeFile(TOOLTIP_TEST, tooltipTest, 'utf8');

await unlink(WORKFLOW).catch(() => {});
await unlink(import.meta.filename).catch(() => {});
