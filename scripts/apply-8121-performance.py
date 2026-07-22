from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    file.write_text(source.replace(old, new, 1))


# ── Persistent sizing settings ────────────────────────────────────────────────
replace_once(
    "lib/types.ts",
    "  quickBarSize: QuickBarSize;\n  quickBarCustomUrl: string;",
    "  quickBarSize: QuickBarSize;\n  quickBarWidth: number;      // horizontal dock width in CSS pixels\n  quickBarIconSize: number;   // action icon size in CSS pixels\n  quickBarCustomUrl: string;",
    "Quick Bar sizing fields",
)
replace_once(
    "lib/types.ts",
    "  quickBarSize: 'comfortable',\n  quickBarCustomUrl: '',",
    "  quickBarSize: 'comfortable',\n  quickBarWidth: 50,\n  quickBarIconSize: 20,\n  quickBarCustomUrl: '',",
    "Quick Bar sizing defaults",
)

replace_once(
    "lib/quickbarConfig.ts",
    "export function normalizeQuickBarColor(value: unknown): string {",
    "export const QUICKBAR_WIDTH_MIN = 34;\nexport const QUICKBAR_WIDTH_MAX = 86;\nexport const QUICKBAR_WIDTH_DEFAULT = 50;\nexport const QUICKBAR_ICON_MIN = 14;\nexport const QUICKBAR_ICON_MAX = 26;\nexport const QUICKBAR_ICON_DEFAULT = 20;\n\nfunction clampNumber(value: unknown, fallback: number, min: number, max: number): number {\n  const parsed = typeof value === 'number' ? value : Number(value);\n  if (!Number.isFinite(parsed)) return fallback;\n  return Math.round(Math.max(min, Math.min(max, parsed)));\n}\n\nexport function normalizeQuickBarWidth(value: unknown): number {\n  return clampNumber(value, QUICKBAR_WIDTH_DEFAULT, QUICKBAR_WIDTH_MIN, QUICKBAR_WIDTH_MAX);\n}\n\nexport function normalizeQuickBarIconSize(value: unknown): number {\n  return clampNumber(value, QUICKBAR_ICON_DEFAULT, QUICKBAR_ICON_MIN, QUICKBAR_ICON_MAX);\n}\n\nexport function normalizeQuickBarColor(value: unknown): string {",
    "Quick Bar sizing normalizers",
)

# ── Resizable Quick Bar + immediate paint ─────────────────────────────────────
replace_once(
    "lib/quickbar.ts",
    "import { normalizeQuickBarColor, normalizeQuickBarOrder, normalizeQuickBarUrl, rememberRecentCollection, reorderQuickBarAction, splitRecentCollections } from './quickbarConfig';",
    "import { QUICKBAR_ICON_DEFAULT, QUICKBAR_WIDTH_DEFAULT, normalizeQuickBarColor, normalizeQuickBarIconSize, normalizeQuickBarOrder, normalizeQuickBarUrl, normalizeQuickBarWidth, rememberRecentCollection, reorderQuickBarAction, splitRecentCollections } from './quickbarConfig';",
    "Quick Bar sizing imports",
)
replace_once(
    "lib/quickbar.ts",
    "export async function mountQuickBar(): Promise<QuickBarApi | null> {",
    "export async function mountQuickBar(initialSettings?: Settings): Promise<QuickBarApi | null> {",
    "initial settings parameter",
)
replace_once(
    "lib/quickbar.ts",
    "  const settings = await getSettings();\n  let currentSettings = settings;\n  let accent = normalizeQuickBarColor(settings.quickBarColor) || ACCENTS.find((item) => item.key === settings.accent)?.swatch || '#2563eb';",
    "  const settings = initialSettings ?? await getSettings();\n  let currentSettings = settings;\n  let railWidth = normalizeQuickBarWidth(settings.quickBarWidth);\n  let actionIconSize = normalizeQuickBarIconSize(settings.quickBarIconSize);\n  let accent = normalizeQuickBarColor(settings.quickBarColor) || ACCENTS.find((item) => item.key === settings.accent)?.swatch || '#2563eb';",
    "Quick Bar sizing state",
)
replace_once(
    "lib/quickbar.ts",
    "  host.style.setProperty('--ks-accent', accent);",
    "  host.style.setProperty('--ks-accent', accent);\n  host.style.setProperty('--ks-rail-width', `${railWidth}px`);\n  host.style.setProperty('--ks-icon-size', `${actionIconSize}px`);",
    "initial sizing variables",
)
replace_once(
    "lib/quickbar.ts",
    "    .rail { position: fixed; z-index: 2147483646; display: flex; flex-direction: column;\n      align-items: center; gap: 3px; padding: 7px 5px; color: #fff;",
    "    .rail { position: fixed; z-index: 2147483646; display: flex; flex-direction: column;\n      align-items: center; gap: 3px; width: var(--ks-rail-width, 50px); padding: 7px 5px; color: #fff;",
    "rail width CSS",
)
replace_once(
    "lib/quickbar.ts",
    "      opacity: .86; transition: opacity .16s, filter .16s; }",
    "      opacity: .86; transition: opacity .16s, filter .16s, width .08s ease; }\n    .rail.resizing { opacity: 1; transition: none; user-select: none; }",
    "rail resize transition",
)
replace_once(
    "lib/quickbar.ts",
    "    .grip { width: 38px; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.55);",
    "    .grip { width: 100%; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.55);",
    "grip flexible width",
)
replace_once(
    "lib/quickbar.ts",
    "    .mini { width: 38px; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.56);",
    "    .mini { width: 100%; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.56);",
    "mini flexible width",
)
replace_once(
    "lib/quickbar.ts",
    "    .btn { width: 38px; height: 38px; display: grid; place-items: center; color: rgba(255,255,255,.92);",
    "    .btn { width: 100%; height: 38px; display: grid; place-items: center; color: rgba(255,255,255,.92);",
    "button flexible width",
)
replace_once(
    "lib/quickbar.ts",
    "    .actions { display: flex; flex-direction: column; align-items: center; gap: 3px; }",
    "    .actions { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 3px; }\n    .btn svg { width: var(--ks-icon-size, 20px); height: var(--ks-icon-size, 20px); }\n    .mini svg, .grip svg { width: calc(var(--ks-icon-size, 20px) - 3px); height: calc(var(--ks-icon-size, 20px) - 3px); }\n    .resize-handle { position: absolute; top: 14px; bottom: 14px; width: 8px; z-index: 3; cursor: ew-resize; touch-action: none; opacity: 0; transition: opacity .12s; }\n    .resize-handle::after { content: ''; position: absolute; top: 35%; bottom: 35%; width: 2px; border-radius: 99px; background: rgba(255,255,255,.5); }\n    .rail.right .resize-handle { left: -4px; }\n    .rail.right .resize-handle::after { left: 3px; }\n    .rail.left .resize-handle { right: -4px; }\n    .rail.left .resize-handle::after { right: 3px; }\n    .rail:hover .resize-handle, .rail.resizing .resize-handle { opacity: .8; }",
    "actions and resize CSS",
)
replace_once(
    "lib/quickbar.ts",
    "    .rail.compact .btn { width: 32px; height: 32px; border-radius: 9px; }\n    .rail.compact .mini, .rail.compact .grip { width: 32px; height: 19px; }",
    "    .rail.compact .btn { width: 100%; height: 32px; border-radius: 9px; }\n    .rail.compact .mini, .rail.compact .grip { width: 100%; height: 19px; }",
    "compact flexible width",
)
replace_once(
    "lib/quickbar.ts",
    "  rail.innerHTML = `\n    <button class=\"mini hide\"",
    "  rail.innerHTML = `\n    <div class=\"resize-handle\" role=\"separator\" aria-orientation=\"vertical\" aria-label=\"Resize Quick Bar horizontally\" data-tooltip=\"Drag to resize width\"></div>\n    <button class=\"mini hide\"",
    "resize handle markup",
)
replace_once(
    "lib/quickbar.ts",
    "  const hideButton = rail.querySelector('.hide') as HTMLButtonElement;",
    "  const resizeHandle = rail.querySelector('.resize-handle') as HTMLDivElement;\n  const hideButton = rail.querySelector('.hide') as HTMLButtonElement;",
    "resize handle query",
)
replace_once(
    "lib/quickbar.ts",
    "  let dragging = false;\n  let saving = false;",
    "  let dragging = false;\n  let resizing = false;\n  let saving = false;",
    "resizing state",
)
replace_once(
    "lib/quickbar.ts",
    "  const applyAll = () => {\n    applyEdge();\n    applyCollapsed();\n  };",
    "  const applySizing = () => {\n    railWidth = normalizeQuickBarWidth(railWidth);\n    actionIconSize = normalizeQuickBarIconSize(actionIconSize);\n    host.style.setProperty('--ks-rail-width', `${railWidth}px`);\n    host.style.setProperty('--ks-icon-size', `${actionIconSize}px`);\n    resizeHandle.setAttribute('aria-valuenow', String(railWidth));\n    applyTop();\n  };\n\n  const applyAll = () => {\n    applyEdge();\n    applySizing();\n    applyCollapsed();\n  };",
    "apply sizing",
)
replace_once(
    "lib/quickbar.ts",
    "    collapsed = next.quickBarCollapsed;\n    accent = normalizeQuickBarColor(next.quickBarColor)",
    "    collapsed = next.quickBarCollapsed;\n    railWidth = normalizeQuickBarWidth(next.quickBarWidth);\n    actionIconSize = normalizeQuickBarIconSize(next.quickBarIconSize);\n    accent = normalizeQuickBarColor(next.quickBarColor)",
    "settings sizing update",
)
replace_once(
    "lib/quickbar.ts",
    "  grip.addEventListener('pointerup', finishDrag);\n  grip.addEventListener('pointercancel', finishDrag);",
    "  grip.addEventListener('pointerup', finishDrag);\n  grip.addEventListener('pointercancel', finishDrag);\n\n  const finishResize = async () => {\n    if (!resizing) return;\n    resizing = false;\n    rail.classList.remove('resizing');\n    await setSettings({ quickBarWidth: railWidth });\n  };\n\n  resizeHandle.addEventListener('pointerdown', (event) => {\n    resizing = true;\n    rail.classList.add('resizing');\n    resizeHandle.setPointerCapture(event.pointerId);\n    closePopover();\n    event.preventDefault();\n    event.stopPropagation();\n  });\n  resizeHandle.addEventListener('pointermove', (event) => {\n    if (!resizing) return;\n    railWidth = normalizeQuickBarWidth(side === 'right' ? window.innerWidth - event.clientX : event.clientX);\n    applySizing();\n  });\n  resizeHandle.addEventListener('pointerup', finishResize);\n  resizeHandle.addEventListener('pointercancel', finishResize);\n  resizeHandle.addEventListener('dblclick', async () => {\n    railWidth = QUICKBAR_WIDTH_DEFAULT;\n    applySizing();\n    updateFromSettings(await setSettings({ quickBarWidth: railWidth }));\n  });",
    "horizontal resizing events",
)
replace_once(
    "lib/quickbar.ts",
    "    hint.textContent = 'Drag any action button directly on the dock to reorder it.';",
    "    hint.textContent = 'Drag actions to reorder. Drag the dock’s inner edge to resize it horizontally.';",
    "customize hint",
)
replace_once(
    "lib/quickbar.ts",
    "    form.appendChild(sizeWrap);\n\n    const colorLabel",
    "    form.appendChild(sizeWrap);\n\n    const widthLabel = document.createElement('label');\n    const widthText = document.createElement('span');\n    widthText.textContent = `Dock width — ${railWidth}px`;\n    const widthInput = document.createElement('input');\n    widthInput.type = 'range';\n    widthInput.min = '34';\n    widthInput.max = '86';\n    widthInput.step = '1';\n    widthInput.value = String(railWidth);\n    widthInput.oninput = () => {\n      railWidth = normalizeQuickBarWidth(widthInput.value);\n      widthText.textContent = `Dock width — ${railWidth}px`;\n      applySizing();\n    };\n    widthInput.onchange = async () => updateFromSettings(await setSettings({ quickBarWidth: railWidth }));\n    widthLabel.append(widthText, widthInput);\n    form.appendChild(widthLabel);\n\n    const iconLabel = document.createElement('label');\n    const iconText = document.createElement('span');\n    iconText.textContent = `Icon size — ${actionIconSize}px`;\n    const iconInput = document.createElement('input');\n    iconInput.type = 'range';\n    iconInput.min = '14';\n    iconInput.max = '26';\n    iconInput.step = '1';\n    iconInput.value = String(actionIconSize);\n    iconInput.oninput = () => {\n      actionIconSize = normalizeQuickBarIconSize(iconInput.value);\n      iconText.textContent = `Icon size — ${actionIconSize}px`;\n      applySizing();\n    };\n    iconInput.onchange = async () => updateFromSettings(await setSettings({ quickBarIconSize: actionIconSize }));\n    iconLabel.append(iconText, iconInput);\n    form.appendChild(iconLabel);\n\n    const colorLabel",
    "width and icon sliders",
)
replace_once(
    "lib/quickbar.ts",
    "    const save = document.createElement('button');",
    "    const resetSize = document.createElement('button');\n    resetSize.type = 'button';\n    resetSize.className = 'chip';\n    resetSize.textContent = 'Reset size';\n    resetSize.onclick = async () => {\n      updateFromSettings(await setSettings({ quickBarWidth: QUICKBAR_WIDTH_DEFAULT, quickBarIconSize: QUICKBAR_ICON_DEFAULT }));\n      openCustomize();\n    };\n    const save = document.createElement('button');",
    "reset sizing button",
)
replace_once(
    "lib/quickbar.ts",
    "    buttons.append(reset, save);",
    "    buttons.append(reset, resetSize, save);",
    "customize buttons",
)
replace_once(
    "lib/quickbar.ts",
    "  if (await loggedIn()) {\n    await refreshExisting();\n    if (currentSettings.recallEnabled) window.setTimeout(() => loadRelated().catch(() => {}), 700);\n  } else {\n    paintSave();\n  }",
    "  // Paint immediately. Auth, duplicate lookup, and Recall hydrate after the\n  // dock is already interactive so a slow cloud backend never delays the UI.\n  paintSave();\n  window.setTimeout(() => {\n    loggedIn()\n      .then(async (yes) => {\n        if (!yes || destroyed) return;\n        await refreshExisting();\n        if (currentSettings.recallEnabled && !destroyed) {\n          window.setTimeout(() => loadRelated().catch(() => {}), 500);\n        }\n      })\n      .catch(() => {});\n  }, 0);",
    "deferred Quick Bar hydration",
)

# ── Content scripts: earlier visual mount, no backend blocking ─────────────────
replace_once(
    "entrypoints/content.ts",
    "import { getBackend } from '@/lib/backend';\n",
    "",
    "blocking backend import",
)
replace_once(
    "entrypoints/content.ts",
    "  runAt: 'document_idle',",
    "  runAt: 'document_end',",
    "earlier content script run time",
)
replace_once(
    "entrypoints/content.ts",
    "    // Authentication/backend startup must never prevent the in-page control from\n    // mounting. The Quick Bar handles signed-out and offline states itself.\n    await getBackend().catch(() => null);\n    const settings = await getSettings();",
    "    // Read only the tiny synced settings record before painting. Backend/auth\n    // startup is deferred inside the Quick Bar and can never block the page UI.\n    const settings = await getSettings();\n    let latestSettings = settings;",
    "nonblocking content startup",
)
replace_once(
    "entrypoints/content.ts",
    "      mounting = mountQuickBar()",
    "      mounting = mountQuickBar(latestSettings)",
    "reuse initial settings",
)
replace_once(
    "entrypoints/content.ts",
    "    if (quickBarEnabled) await ensureQuickBar();",
    "    if (quickBarEnabled) ensureQuickBar().catch(() => {});",
    "nonblocking Quick Bar mount",
)
replace_once(
    "entrypoints/content.ts",
    "    watchSettings(async (next) => {\n      quickBarEnabled = next.enableQuickBar;",
    "    watchSettings(async (next) => {\n      latestSettings = next;\n      quickBarEnabled = next.enableQuickBar;",
    "latest settings tracking",
)
replace_once(
    "entrypoints/content.ts",
    "    injectStyles();\n    await reapplyHighlights();",
    "    injectStyles();\n    // Rebuilding quote anchors walks page text; keep it off the critical render\n    // path and let the page/Quick Bar become interactive first.\n    window.setTimeout(() => reapplyHighlights().catch(() => {}), 350);",
    "deferred highlight restoration",
)
replace_once(
    "entrypoints/ai-embed.content.ts",
    "  runAt: 'document_idle',",
    "  runAt: 'document_end',",
    "earlier embedded AI runtime",
)

# ── Popup: prevent duplicate startup queries and defer secondary metadata ──────
replace_once(
    "entrypoints/popup/App.tsx",
    "  const uidRef = useRef<string | null>(null);",
    "  const uidRef = useRef<string | null>(null);\n  const collectionsRef = useRef(collectionsApi.collections);\n  const countsRef = useRef(collectionsApi.counts);\n\n  useEffect(() => { collectionsRef.current = collectionsApi.collections; }, [collectionsApi.collections]);\n  useEffect(() => { countsRef.current = collectionsApi.counts; }, [collectionsApi.counts]);",
    "popup collection refs",
)
replace_once(
    "entrypoints/popup/App.tsx",
    "          collections: collectionsApi.collections,\n          counts: collectionsApi.counts,",
    "          collections: collectionsRef.current,\n          counts: countsRef.current,",
    "popup snapshot refs",
)
replace_once(
    "entrypoints/popup/App.tsx",
    "  }, [filter, query, collectionsApi.collections, collectionsApi.counts]);",
    "  }, [filter, query]);",
    "popup run dependencies",
)
replace_once(
    "entrypoints/popup/App.tsx",
    "  useEffect(() => {\n    const timer = setTimeout(run, 60);",
    "  useEffect(() => {\n    const timer = setTimeout(run, 20);",
    "faster popup primary query",
)
replace_once(
    "entrypoints/popup/App.tsx",
    "  useEffect(() => {\n    refreshMeta();\n  }, [refreshMeta]);",
    "  useEffect(() => {\n    // Stats/tags are secondary UI. Let cached rows and the primary bookmark query\n    // paint first instead of competing for the backend during popup startup.\n    const timer = window.setTimeout(refreshMeta, 240);\n    return () => window.clearTimeout(timer);\n  }, [refreshMeta]);",
    "deferred popup metadata",
)

# ── Home: remove duplicate boot refreshes and defer nonvisual work ─────────────
replace_once(
    "entrypoints/newtab/App.tsx",
    "  const reloadAll = useCallback(() => {\n    // Keep current links on screen if the request is slow/fails — never blank out.\n    // home: true fetches ONLY launcher rows (pinned || homeOnly), projected light\n    // (no cached page content), so a new tab loads a few small tiles instead of\n    // the whole library. Home only ever renders pinned items anyway.\n    searchBookmarks('', { home: true, perPage: 500 }).then(setAll).catch(() => {});\n    getAllTags().then((t) => setAllTags(t.map((x) => x.tag))).catch(() => {});\n  }, []);",
    "  const reloadAll = useCallback(() => {\n    // Primary visual data only. Nonvisual tags and overlay healing run later so\n    // tiles never wait behind secondary backend work.\n    searchBookmarks('', { home: true, perPage: 500 }).then(setAll).catch(() => {});\n  }, []);\n  const reloadTags = useCallback(() => {\n    getAllTags().then((t) => setAllTags(t.map((x) => x.tag))).catch(() => {});\n  }, []);",
    "split Home primary and secondary loads",
)
replace_once(
    "entrypoints/newtab/App.tsx",
    "  useEffect(() => {\n    if (authed) reloadAll();\n  }, [authed, reloadAll]);",
    "  useEffect(() => {\n    if (!authed) return;\n    reloadAll();\n    const tagTimer = window.setTimeout(reloadTags, 500);\n    return () => window.clearTimeout(tagTimer);\n  }, [authed, reloadAll, reloadTags]);",
    "deferred Home tags",
)
replace_once(
    "entrypoints/newtab/App.tsx",
    "  useEffect(() => {\n    if (!authed) return;\n    syncHomeOverlay().then(reloadAll).catch(() => {});\n  }, [authed, reloadAll]);",
    "  useEffect(() => {\n    if (!authed) return;\n    // Overlay repair is important but not first-paint work. Running it immediately\n    // caused a second full Home refresh while the first request was still active.\n    const timer = window.setTimeout(() => {\n      syncHomeOverlay().then(reloadAll).catch(() => {});\n    }, 1200);\n    return () => window.clearTimeout(timer);\n  }, [authed, reloadAll]);",
    "deferred Home overlay sync",
)
replace_once(
    "entrypoints/newtab/App.tsx",
    "      reloadAll();\n      c.refresh();",
    "      reloadAll();\n      window.setTimeout(reloadTags, 250);\n      c.refresh();",
    "Home vault refresh tags",
)
replace_once(
    "entrypoints/newtab/App.tsx",
    "  }, [authed, reloadAll, c]);",
    "  }, [authed, reloadAll, reloadTags, c.refresh]);",
    "stable Home watcher dependencies",
)
replace_once(
    "entrypoints/newtab/App.tsx",
    "    const text = await file.text();\n    const { items } = detectAndParse(file.name, text);",
    "    const text = await file.text();\n    const { detectAndParse, importWithAi } = await import('@/lib/importer');\n    const { items } = detectAndParse(file.name, text);",
    "lazy importer",
)
replace_once(
    "entrypoints/newtab/App.tsx",
    "import { detectAndParse, importWithAi } from '@/lib/importer';\n",
    "",
    "eager importer import",
)

# ── Tests and release version ──────────────────────────────────────────────────
replace_once(
    "scripts/test-quickbar-config.mjs",
    "  normalizeQuickBarColor,\n  normalizeQuickBarUrl,",
    "  normalizeQuickBarColor,\n  normalizeQuickBarWidth,\n  normalizeQuickBarIconSize,\n  normalizeQuickBarUrl,",
    "sizing test imports",
)
Path("scripts/test-quickbar-config.mjs").write_text(
    Path("scripts/test-quickbar-config.mjs").read_text()
    + "\n\ntest('dock width and icon sizing are clamped and migration-safe', () => {\n"
      "  assert.equal(normalizeQuickBarWidth(undefined), 50);\n"
      "  assert.equal(normalizeQuickBarWidth(8), 34);\n"
      "  assert.equal(normalizeQuickBarWidth(200), 86);\n"
      "  assert.equal(normalizeQuickBarIconSize(undefined), 20);\n"
      "  assert.equal(normalizeQuickBarIconSize(5), 14);\n"
      "  assert.equal(normalizeQuickBarIconSize(40), 26);\n"
      "});\n"
)

Path("scripts/test-performance-surfaces.mjs").write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const quickbar = await readFile(new URL('../lib/quickbar.ts', import.meta.url), 'utf8');
const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const aiEmbed = await readFile(new URL('../entrypoints/ai-embed.content.ts', import.meta.url), 'utf8');
const popup = await readFile(new URL('../entrypoints/popup/App.tsx', import.meta.url), 'utf8');
const home = await readFile(new URL('../entrypoints/newtab/App.tsx', import.meta.url), 'utf8');

test('Quick Bar paints before backend hydration and supports direct horizontal resizing', () => {
  assert.match(quickbar, /class="resize-handle"/);
  assert.match(quickbar, /quickBarWidth/);
  assert.match(quickbar, /quickBarIconSize/);
  assert.match(quickbar, /Paint immediately/);
  assert.doesNotMatch(quickbar, /if \(await loggedIn\(\)\) \{\s*await refreshExisting/);
});

test('page controls run at document_end without blocking on backend startup', () => {
  assert.match(content, /runAt: 'document_end'/);
  assert.doesNotMatch(content, /await getBackend\(\)/);
  assert.match(content, /mountQuickBar\(latestSettings\)/);
  assert.match(aiEmbed, /runAt: 'document_end'/);
});

test('popup and Home prioritize visual data over secondary metadata', () => {
  assert.match(popup, /setTimeout\(refreshMeta, 240\)/);
  assert.match(popup, /collectionsRef\.current/);
  assert.match(home, /setTimeout\(reloadTags, 500\)/);
  assert.match(home, /setTimeout\(\(\) => \{\s*syncHomeOverlay/);
  assert.match(home, /await import\('@\/lib\/importer'\)/);
});
""")

replace_once(
    "package.json",
    '  "version": "8.12.0",',
    '  "version": "8.12.1",',
    "package version",
)
replace_once(
    "package.json",
    '    "test:ai-upgrade": "node --test scripts/test-ai-812.mjs",\n    "test": "npm run test:retrieval && npm run test:bulk && npm run test:ui && npm run test:quickbar && npm run test:tooltips && npm run test:writer && npm run test:models && npm run test:ai-upgrade",',
    '    "test:ai-upgrade": "node --test scripts/test-ai-812.mjs",\n    "test:performance": "node --test scripts/test-performance-surfaces.mjs",\n    "test": "npm run test:retrieval && npm run test:bulk && npm run test:ui && npm run test:quickbar && npm run test:tooltips && npm run test:writer && npm run test:models && npm run test:ai-upgrade && npm run test:performance",',
    "performance test script",
)
replace_once(
    "wxt.config.ts",
    "    version: '8.12.0',",
    "    version: '8.12.1',",
    "manifest version",
)

# Remove the one-shot generator after it has produced the real source.
Path(__file__).unlink(missing_ok=True)
