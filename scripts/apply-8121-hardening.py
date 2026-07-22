from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    file.write_text(source.replace(old, new, 1))


# ── Typed Quick Bar RPC contract ───────────────────────────────────────────────
replace_once(
    "lib/messaging.ts",
    "  | { type: 'OPEN_QUICKBAR' } // background -> content: pop the quick-save folder picker\n",
    "  | { type: 'OPEN_QUICKBAR' } // background -> content: pop the quick-save folder picker\n"
    "  | { type: 'KS_QUICKBAR_BOOTSTRAP'; url: string }\n"
    "  | { type: 'KS_QUICKBAR_COLLECTIONS' }\n"
    "  | { type: 'KS_QUICKBAR_SEARCH'; query: string; collection?: string; unsorted?: boolean; perPage?: number }\n"
    "  | { type: 'KS_QUICKBAR_CREATE_COLLECTION'; name: string }\n",
    "Quick Bar RPC messages",
)

# ── Background worker owns data access ────────────────────────────────────────
replace_once(
    "entrypoints/background.ts",
    "import { findByUrl, saveBookmark } from '@/lib/bookmarks';",
    "import { countByCollection, createCollection, deleteBookmark, findByUrl, listCollections, saveBookmark, searchBookmarks, updateBookmark } from '@/lib/bookmarks';",
    "consolidated bookmark imports",
)
replace_once(
    "entrypoints/background.ts",
    "import { deleteBookmark, searchBookmarks, updateBookmark } from '@/lib/bookmarks';\n",
    "",
    "duplicate bookmark imports",
)
replace_once(
    "entrypoints/background.ts",
    "async function handleMessage(msg: Message, sender?: { tab?: { id?: number; windowId?: number } }): Promise<unknown> {\n  await getBackend(); // restore session\n  switch (msg.type) {",
    "async function handleMessage(msg: Message, sender?: { tab?: { id?: number; windowId?: number; url?: string } }): Promise<unknown> {\n  // Do not initialize PocketBase for UI-only messages such as Open URL/Popup.\n  // Data facades initialize the backend only in the cases that actually need it.\n  switch (msg.type) {",
    "nonblocking message hub",
)
replace_once(
    "entrypoints/background.ts",
    "    case 'PING':\n      return { ok: true };\n\n    case 'CAPTURE_SCREENSHOT': {",
    "    case 'PING':\n      return { ok: true };\n\n"
    "    case 'KS_QUICKBAR_BOOTSTRAP': {\n"
    "      const requestUrl = msg.url;\n"
    "      if (sender?.tab?.url && !sameCanonicalUrl(sender.tab.url, requestUrl)) {\n"
    "        return { ok: false, loggedIn: false, existing: null, url: requestUrl, error: 'The page changed.' };\n"
    "      }\n"
    "      const backend = await getBackend();\n"
    "      const loggedIn = await backend.isLoggedIn();\n"
    "      const existing = loggedIn ? await findByUrl(requestUrl).catch(() => null) : null;\n"
    "      return { ok: true, loggedIn, existing, url: requestUrl };\n"
    "    }\n\n"
    "    case 'KS_QUICKBAR_COLLECTIONS': {\n"
    "      const backend = await getBackend();\n"
    "      if (!(await backend.isLoggedIn())) return { ok: false, collections: [], counts: {}, error: 'Sign in first.' };\n"
    "      const [collections, counts] = await Promise.all([listCollections(), countByCollection()]);\n"
    "      return { ok: true, collections, counts };\n"
    "    }\n\n"
    "    case 'KS_QUICKBAR_SEARCH': {\n"
    "      const backend = await getBackend();\n"
    "      if (!(await backend.isLoggedIn())) return { ok: false, items: [], error: 'Sign in first.' };\n"
    "      const query = msg.query.trim().slice(0, 240);\n"
    "      const requested = Number.isFinite(msg.perPage) ? Number(msg.perPage) : 50;\n"
    "      const perPage = Math.max(1, Math.min(msg.unsorted ? 300 : 60, requested));\n"
    "      let items = await searchBookmarks(query, { collection: msg.collection, perPage });\n"
    "      if (msg.unsorted) items = items.filter((item) => !item.collection);\n"
    "      return { ok: true, items: items.filter((item) => !item.homeOnly).slice(0, 50) };\n"
    "    }\n\n"
    "    case 'KS_QUICKBAR_CREATE_COLLECTION': {\n"
    "      const name = msg.name.trim().slice(0, 80);\n"
    "      if (!name) return { ok: false, error: 'Add a collection name.' };\n"
    "      const collection = await createCollection({ name });\n"
    "      return { ok: true, collection };\n"
    "    }\n\n"
    "    case 'CAPTURE_SCREENSHOT': {",
    "Quick Bar RPC handlers",
)

# ── Lightweight Quick Bar: no PocketBase/backend imports on websites ──────────
replace_once(
    "lib/quickbar.ts",
    "import { getBackend } from './backend';\nimport { listCollections, createCollection, findByUrl, searchBookmarks, countByCollection } from './bookmarks';\n",
    "",
    "direct backend imports",
)
replace_once(
    "lib/quickbar.ts",
    "export interface QuickBarApi {\n  openFolders: () => void;\n  update: (settings: Settings) => void;\n  destroy: () => void;\n}",
    "export interface QuickBarApi {\n  openFolders: () => void;\n  refreshPage: () => void;\n  update: (settings: Settings) => void;\n  destroy: () => void;\n}",
    "Quick Bar refresh API",
)
replace_once(
    "lib/quickbar.ts",
    "type QuickBarHost = HTMLDivElement & { __keepsakeApi?: QuickBarApi };\n",
    "type QuickBarHost = HTMLDivElement & { __keepsakeApi?: QuickBarApi };\n\n"
    "interface QuickBarBootstrapResult {\n"
    "  ok?: boolean;\n"
    "  loggedIn: boolean;\n"
    "  existing?: Bookmark | null;\n"
    "  url: string;\n"
    "  error?: string;\n"
    "}\n\n"
    "interface QuickBarCollectionsResult {\n"
    "  ok?: boolean;\n"
    "  collections?: Collection[];\n"
    "  counts?: Record<string, number>;\n"
    "  error?: string;\n"
    "}\n\n"
    "interface QuickBarSearchResult { ok?: boolean; items?: Bookmark[]; error?: string }\n"
    "interface QuickBarCreateCollectionResult { ok?: boolean; collection?: Collection; error?: string }\n",
    "Quick Bar RPC result types",
)
replace_once(
    "lib/quickbar.ts",
    "    .btn svg { width: var(--ks-icon-size, 20px); height: var(--ks-icon-size, 20px); }",
    "    .btn svg { width: var(--ks-icon-size, 20px); height: var(--ks-icon-size, 20px); max-width: calc(100% - 4px); max-height: calc(100% - 4px); }",
    "icon fit guard",
)
replace_once(
    "lib/quickbar.ts",
    "    .rail:hover .resize-handle, .rail.resizing .resize-handle { opacity: .8; }",
    "    .rail:hover .resize-handle, .rail.resizing .resize-handle, .resize-handle:focus-visible { opacity: .9; }\n"
    "    .resize-handle:focus-visible { outline: 2px solid var(--ks-accent); outline-offset: 1px; }",
    "resize focus style",
)
replace_once(
    "lib/quickbar.ts",
    "    <div class=\"resize-handle\" role=\"separator\" aria-orientation=\"vertical\" aria-label=\"Resize Quick Bar horizontally\" data-tooltip=\"Drag to resize width\"></div>",
    "    <div class=\"resize-handle\" role=\"separator\" tabindex=\"0\" aria-orientation=\"vertical\" aria-valuemin=\"34\" aria-valuemax=\"86\" aria-label=\"Resize Quick Bar horizontally\" data-tooltip=\"Drag to resize width\"></div>",
    "accessible resize handle",
)
replace_once(
    "lib/quickbar.ts",
    "  let existingBookmark: Bookmark | null = null;\n  let related: RecallItem[] = [];\n  let collectionCache: { items: Collection[]; at: number } | null = null;",
    "  let existingBookmark: Bookmark | null = null;\n  let authenticated: boolean | null = null;\n  let authCheckedAt = 0;\n  let related: RecallItem[] = [];\n  let collectionCache: { items: Collection[]; counts: Record<string, number>; at: number } | null = null;",
    "Quick Bar lightweight state",
)
replace_once(
    "lib/quickbar.ts",
    "  resizeHandle.addEventListener('dblclick', async () => {\n    railWidth = QUICKBAR_WIDTH_DEFAULT;\n    applySizing();\n    updateFromSettings(await setSettings({ quickBarWidth: railWidth }));\n  });",
    "  resizeHandle.addEventListener('dblclick', async () => {\n    railWidth = QUICKBAR_WIDTH_DEFAULT;\n    applySizing();\n    updateFromSettings(await setSettings({ quickBarWidth: railWidth }));\n  });\n"
    "  resizeHandle.addEventListener('keydown', (event) => {\n"
    "    let next = railWidth;\n"
    "    if (event.key === 'ArrowLeft') next -= side === 'right' ? 2 : -2;\n"
    "    else if (event.key === 'ArrowRight') next += side === 'right' ? 2 : -2;\n"
    "    else if (event.key === 'Home') next = 34;\n"
    "    else if (event.key === 'End') next = 86;\n"
    "    else return;\n"
    "    event.preventDefault();\n"
    "    railWidth = normalizeQuickBarWidth(next);\n"
    "    applySizing();\n"
    "  });\n"
    "  resizeHandle.addEventListener('keyup', (event) => {\n"
    "    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;\n"
    "    setSettings({ quickBarWidth: railWidth }).catch(() => {});\n"
    "  });",
    "keyboard resizing",
)
replace_once(
    "lib/quickbar.ts",
    "  async function loggedIn(): Promise<boolean> {\n    try {\n      return (await getBackend()).isLoggedIn();\n    } catch {\n      return false;\n    }\n  }",
    "  async function refreshBootstrap(): Promise<boolean> {\n"
    "    const pageUrl = location.href;\n"
    "    const response = await send<QuickBarBootstrapResult>({ type: 'KS_QUICKBAR_BOOTSTRAP', url: pageUrl }).catch(() => null);\n"
    "    if (!response?.ok || response.url !== pageUrl || location.href !== pageUrl) return authenticated ?? false;\n"
    "    authenticated = response.loggedIn;\n"
    "    authCheckedAt = Date.now();\n"
    "    existingBookmark = response.loggedIn ? response.existing ?? null : null;\n"
    "    paintSave();\n"
    "    return response.loggedIn;\n"
    "  }\n\n"
    "  async function loggedIn(): Promise<boolean> {\n"
    "    const ttl = authenticated ? 30_000 : 3_000;\n"
    "    if (authenticated != null && Date.now() - authCheckedAt < ttl) return authenticated;\n"
    "    return refreshBootstrap();\n"
    "  }",
    "background-backed auth state",
)
replace_once(
    "lib/quickbar.ts",
    "  const loadCollections = async (): Promise<Collection[]> => {\n    if (collectionCache && Date.now() - collectionCache.at < 60_000) return collectionCache.items;\n    const items = await listCollections();\n    collectionCache = { items, at: Date.now() };\n    return items;\n  };",
    "  const loadCollectionData = async (): Promise<{ items: Collection[]; counts: Record<string, number> }> => {\n"
    "    if (collectionCache && Date.now() - collectionCache.at < 60_000) return collectionCache;\n"
    "    const response = await send<QuickBarCollectionsResult>({ type: 'KS_QUICKBAR_COLLECTIONS' }).catch(() => null);\n"
    "    if (!response?.ok) throw new Error(response?.error || 'Collections are unavailable.');\n"
    "    collectionCache = { items: response.collections ?? [], counts: response.counts ?? {}, at: Date.now() };\n"
    "    return collectionCache;\n"
    "  };\n\n"
    "  const loadCollections = async (): Promise<Collection[]> => (await loadCollectionData()).items;\n\n"
    "  const searchVault = async (query: string, options: { collection?: string; unsorted?: boolean; perPage?: number } = {}) => {\n"
    "    const response = await send<QuickBarSearchResult>({\n"
    "      type: 'KS_QUICKBAR_SEARCH',\n"
    "      query,\n"
    "      collection: options.collection,\n"
    "      unsorted: options.unsorted,\n"
    "      perPage: options.perPage,\n"
    "    }).catch(() => null);\n"
    "    if (!response?.ok) throw new Error(response?.error || 'Search is unavailable.');\n"
    "    return response.items ?? [];\n"
    "  };",
    "background-backed collection and search helpers",
)
replace_once(
    "lib/quickbar.ts",
    "  const refreshExisting = async () => {\n    existingBookmark = await findByUrl(location.href).catch(() => null);\n    paintSave();\n  };",
    "  const refreshExisting = async () => {\n    await refreshBootstrap();\n  };",
    "background-backed duplicate refresh",
)
replace_once(
    "lib/quickbar.ts",
    "        const created = await createCollection({ name });\n        collectionCache = null;\n        if (moveMode) await moveExisting(created.id);\n        else await quickSave(created.id, false, true);",
    "        const response = await send<QuickBarCreateCollectionResult>({ type: 'KS_QUICKBAR_CREATE_COLLECTION', name }).catch(() => null);\n"
    "        if (!response?.ok || !response.collection) throw new Error(response?.error || 'Collection creation failed.');\n"
    "        collectionCache = null;\n"
    "        if (moveMode) await moveExisting(response.collection.id);\n"
    "        else await quickSave(response.collection.id, false, true);",
    "background-backed collection creation",
)
replace_once(
    "lib/quickbar.ts",
    "      const [collections, counts] = await Promise.all([loadCollections(), countByCollection()]);",
    "      const { items: collections, counts } = await loadCollectionData();",
    "single collection RPC",
)
replace_once(
    "lib/quickbar.ts",
    "      let items = await searchBookmarks(query, {\n        collection: collectionId,\n        perPage: unsorted ? 300 : 50,\n      }).catch(() => []);\n      if (unsorted) items = items.filter((item) => !item.collection);\n      items = items.filter((item) => !item.homeOnly).slice(0, 50);",
    "      let items: Bookmark[];\n"
    "      try {\n"
    "        items = await searchVault(query, { collection: collectionId, unsorted, perPage: unsorted ? 300 : 50 });\n"
    "      } catch {\n"
    "        if (popover === panel && current === sequence) results.innerHTML = '<div class=\"empty\">Bookmarks could not be loaded. Try again.</div>';\n"
    "        return;\n"
    "      }",
    "collection search RPC",
)
replace_once(
    "lib/quickbar.ts",
    "      const items = await searchBookmarks(query, { perPage: 8 }).catch(() => []);\n      if (sequence !== searchSequence || popover !== panel) return;\n      addBookmarkRows(results, items.filter((item) => !item.homeOnly), query ? 'No matching saves.' : 'Your library is empty.');",
    "      let items: Bookmark[];\n"
    "      try {\n"
    "        items = await searchVault(query, { perPage: 8 });\n"
    "      } catch {\n"
    "        if (sequence === searchSequence && popover === panel) results.innerHTML = '<div class=\"empty\">Search is unavailable. Try again.</div>';\n"
    "        return;\n"
    "      }\n"
    "      if (sequence !== searchSequence || popover !== panel) return;\n"
    "      addBookmarkRows(results, items, query ? 'No matching saves.' : 'Your library is empty.');",
    "global search RPC",
)
replace_once(
    "lib/quickbar.ts",
    "  // Paint immediately. Auth, duplicate lookup, and Recall hydrate after the\n  // dock is already interactive so a slow cloud backend never delays the UI.\n  paintSave();\n  window.setTimeout(() => {\n    loggedIn()\n      .then(async (yes) => {\n        if (!yes || destroyed) return;\n        await refreshExisting();\n        if (currentSettings.recallEnabled && !destroyed) {\n          window.setTimeout(() => loadRelated().catch(() => {}), 500);\n        }\n      })\n      .catch(() => {});\n  }, 0);\n\n  const api: QuickBarApi = {\n    openFolders,",
    "  const hydratePageState = async () => {\n"
    "    const pageUrl = location.href;\n"
    "    const yes = await refreshBootstrap();\n"
    "    if (!yes || destroyed || location.href !== pageUrl) return;\n"
    "    if (currentSettings.recallEnabled) window.setTimeout(() => loadRelated().catch(() => {}), 450);\n"
    "  };\n\n"
    "  const refreshPage = () => {\n"
    "    closePopover();\n"
    "    existingBookmark = null;\n"
    "    related = [];\n"
    "    searchSequence++;\n"
    "    paintSave();\n"
    "    renderActions();\n"
    "    window.setTimeout(() => hydratePageState().catch(() => {}), 0);\n"
    "  };\n\n"
    "  // Paint immediately. Auth, duplicate lookup, and Recall hydrate after the\n"
    "  // dock is already interactive so a slow cloud backend never delays the UI.\n"
    "  paintSave();\n"
    "  window.setTimeout(() => hydratePageState().catch(() => {}), 0);\n\n"
    "  const api: QuickBarApi = {\n"
    "    openFolders,\n"
    "    refreshPage,",
    "reusable page hydration",
)
replace_once(
    "lib/quickbar.ts",
    "      if (response.status === 'queued') {\n        paintSave();",
    "      if (response.status === 'queued') {\n        authenticated = true;\n        authCheckedAt = Date.now();\n        paintSave();",
    "offline save auth cache",
)
replace_once(
    "lib/quickbar.ts",
    "      await rememberCollection(collection || response.collection);\n      await refreshExisting();",
    "      authenticated = true;\n      authCheckedAt = Date.now();\n      await rememberCollection(collection || response.collection);\n      await refreshExisting();",
    "successful save auth cache",
)

# ── Content-script lifecycle cleanup and SPA correctness ──────────────────────
replace_once(
    "entrypoints/content.ts",
    "  async main() {",
    "  async main(ctx) {",
    "content context parameter",
)
replace_once(
    "entrypoints/content.ts",
    "    browser.runtime.onMessage.addListener((message: Message) => {\n      if (message.type === 'OPEN_QUICKBAR') {\n        ensureQuickBar().then((api) => api?.openFolders()).catch(() => {});\n        return undefined;\n      }\n      if (message.type === 'KS_AI_SELECTION_GET') return Promise.resolve(selectionResult());\n      if (message.type === 'KS_AI_SELECTION_REPLACE') {\n        return Promise.resolve(replaceCapturedSelection(message.text, message.expectedOriginal));\n      }\n      if (message.type === 'KS_AI_SELECTION_UNDO') return Promise.resolve(undoCapturedReplacement());\n      return undefined;\n    });",
    "    const onRuntimeMessage = (message: Message) => {\n"
    "      if (message.type === 'OPEN_QUICKBAR') {\n"
    "        ensureQuickBar().then((api) => api?.openFolders()).catch(() => {});\n"
    "        return undefined;\n"
    "      }\n"
    "      if (message.type === 'KS_AI_SELECTION_GET') return Promise.resolve(selectionResult());\n"
    "      if (message.type === 'KS_AI_SELECTION_REPLACE') {\n"
    "        return Promise.resolve(replaceCapturedSelection(message.text, message.expectedOriginal));\n"
    "      }\n"
    "      if (message.type === 'KS_AI_SELECTION_UNDO') return Promise.resolve(undoCapturedReplacement());\n"
    "      return undefined;\n"
    "    };\n"
    "    browser.runtime.onMessage.addListener(onRuntimeMessage);\n"
    "    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onRuntimeMessage));",
    "runtime listener cleanup",
)
replace_once(
    "entrypoints/content.ts",
    "    const rememberSoon = () => window.setTimeout(() => rememberSelection(), 0);\n    document.addEventListener('selectionchange', rememberSelection, true);\n    document.addEventListener('mouseup', rememberSoon, true);\n    document.addEventListener('keyup', rememberSoon, true);\n    document.addEventListener('focusin', rememberSoon, true);\n    document.addEventListener('input', rememberSoon, true);",
    "    let rememberTimer = 0;\n"
    "    const rememberSoon = () => {\n"
    "      window.clearTimeout(rememberTimer);\n"
    "      rememberTimer = ctx.setTimeout(() => rememberSelection(), 0);\n"
    "    };\n"
    "    ctx.addEventListener(document, 'selectionchange', rememberSelection, true);\n"
    "    ctx.addEventListener(document, 'mouseup', rememberSoon, true);\n"
    "    ctx.addEventListener(document, 'keyup', rememberSoon, true);\n"
    "    ctx.addEventListener(document, 'focusin', rememberSoon, true);\n"
    "    ctx.addEventListener(document, 'input', rememberSoon, true);",
    "debounced selection listeners",
)
replace_once(
    "entrypoints/content.ts",
    "    watchSettings(async (next) => {",
    "    const unwatchSettings = watchSettings(async (next) => {",
    "settings watcher handle",
)
replace_once(
    "entrypoints/content.ts",
    "      api?.update(next);\n    });\n\n    // Some highly dynamic sites",
    "      api?.update(next);\n    });\n    ctx.onInvalidated(unwatchSettings);\n\n    // Some highly dynamic sites",
    "settings watcher cleanup",
)
replace_once(
    "entrypoints/content.ts",
    "    observer.observe(document.documentElement, { childList: true });\n\n    if (!settings.enableHighlights) return;",
    "    observer.observe(document.documentElement, { childList: true });\n\n"
    "    ctx.locationWatcher.run();\n"
    "    ctx.addEventListener(window, 'wxt:locationchange', () => {\n"
    "      capturedSelection = null;\n"
    "      selectionUndo = null;\n"
    "      quickBar?.refreshPage();\n"
    "    });\n"
    "    ctx.onInvalidated(() => {\n"
    "      observer.disconnect();\n"
    "      quickBar?.destroy();\n"
    "      quickBar = null;\n"
    "    });\n\n"
    "    if (!settings.enableHighlights) return;",
    "SPA refresh and invalidation cleanup",
)
replace_once(
    "entrypoints/content.ts",
    "    document.addEventListener('mousedown', (event) => {",
    "    ctx.addEventListener(document, 'mousedown', (event) => {",
    "highlight mousedown lifecycle",
)
replace_once(
    "entrypoints/content.ts",
    "    document.addEventListener('mouseup', (event) => {",
    "    ctx.addEventListener(document, 'mouseup', (event) => {",
    "highlight mouseup lifecycle",
)
replace_once(
    "entrypoints/content.ts",
    "      setTimeout(() => {\n        const selection = window.getSelection();",
    "      ctx.setTimeout(() => {\n        const selection = window.getSelection();",
    "highlight deferred selection",
)

# ── Embedded AI runs after page resources and cleans up on extension reload ───
replace_once(
    "entrypoints/ai-embed.content.ts",
    "  runAt: 'document_end',\n\n  main() {",
    "  runAt: 'document_idle',\n\n  main(ctx) {",
    "AI embed idle context",
)
replace_once(
    "entrypoints/ai-embed.content.ts",
    "      timer = window.setTimeout(position, 60);",
    "      timer = ctx.setTimeout(position, 60);",
    "AI embed context timer",
)
replace_once(
    "entrypoints/ai-embed.content.ts",
    "    browser.runtime.onMessage.addListener((message: { type?: string }) => {\n      if (message.type === 'KS_AI_PAGE_GET') return Promise.resolve({ ok: true, page: snapshot() });\n      return undefined;\n    });\n\n    document.addEventListener('selectionchange', schedule, true);\n    document.addEventListener('mouseup', schedule, true);\n    document.addEventListener('keyup', schedule, true);\n    document.addEventListener('focusin', schedule, true);\n    document.addEventListener('input', schedule, true);\n    document.addEventListener('mousedown', (event) => {\n      if (event.composedPath().includes(host)) return;\n      window.setTimeout(schedule, 0);\n    }, true);\n    window.addEventListener('scroll', hide, true);\n    window.addEventListener('resize', hide);",
    "    const onRuntimeMessage = (message: { type?: string }) => {\n"
    "      if (message.type === 'KS_AI_PAGE_GET') return Promise.resolve({ ok: true, page: snapshot() });\n"
    "      return undefined;\n"
    "    };\n"
    "    browser.runtime.onMessage.addListener(onRuntimeMessage);\n"
    "    ctx.onInvalidated(() => {\n"
    "      browser.runtime.onMessage.removeListener(onRuntimeMessage);\n"
    "      host.remove();\n"
    "    });\n\n"
    "    ctx.addEventListener(document, 'selectionchange', schedule, true);\n"
    "    ctx.addEventListener(document, 'mouseup', schedule, true);\n"
    "    ctx.addEventListener(document, 'keyup', schedule, true);\n"
    "    ctx.addEventListener(document, 'focusin', schedule, true);\n"
    "    ctx.addEventListener(document, 'input', schedule, true);\n"
    "    ctx.addEventListener(document, 'mousedown', (event) => {\n"
    "      if (event.composedPath().includes(host)) return;\n"
    "      ctx.setTimeout(schedule, 0);\n"
    "    }, true);\n"
    "    ctx.addEventListener(window, 'scroll', hide, true);\n"
    "    ctx.addEventListener(window, 'resize', hide);",
    "AI embed listener cleanup",
)

# ── PocketBase requests fail promptly and creates never auto-duplicate ─────────
replace_once(
    "lib/backend/pocketbase.ts",
    "      options.signal ??= AbortSignal.timeout(30_000);",
    "      options.signal ??= AbortSignal.timeout(8_000);",
    "bounded PocketBase timeout",
)
replace_once(
    "lib/backend/pocketbase.ts",
    "  private async req<T>(fn: () => Promise<T>, retries = 2): Promise<T> {",
    "  private async req<T>(fn: () => Promise<T>, retries = 1): Promise<T> {",
    "bounded default retries",
)
replace_once(
    "lib/backend/pocketbase.ts",
    "    const rec = await this.req(() => this.pb.collection('bookmarks').create(form), 1);",
    "    const rec = await this.req(() => this.pb.collection('bookmarks').create(form), 0);",
    "bookmark create no auto-retry",
)
replace_once(
    "lib/backend/pocketbase.ts",
    "        const results = await this.req(() => batch.send());",
    "        const results = await this.req(() => batch.send(), 0);",
    "batch create no auto-retry",
)
replace_once(
    "lib/backend/pocketbase.ts",
    "      await this.req(() => this.pb.collection('bookmarks').update(id, { lastVisited: new Date().toISOString() }), 1);",
    "      await this.req(() => this.pb.collection('bookmarks').update(id, { lastVisited: new Date().toISOString() }), 0);",
    "visit update no retry",
)
replace_once(
    "lib/backend/pocketbase.ts",
    "    const rec = await this.req(() => this.pb.collection('collections').create({ ...data, user: this.uid() }), 1);",
    "    const rec = await this.req(() => this.pb.collection('collections').create({ ...data, user: this.uid() }), 0);",
    "collection create no auto-retry",
)
replace_once(
    "lib/backend/pocketbase.ts",
    "      1,\n    );\n    return this.normalizeHighlight(rec);",
    "      0,\n    );\n    return this.normalizeHighlight(rec);",
    "highlight create no auto-retry",
)

# ── Performance regression tests and build budgets ────────────────────────────
replace_once(
    "scripts/test-performance-surfaces.mjs",
    "  assert.match(content, /runAt: 'document_end'/);\n  assert.doesNotMatch(content, /await getBackend\\(\\)/);\n  assert.match(content, /mountQuickBar\\(latestSettings\\)/);\n  assert.match(aiEmbed, /runAt: 'document_end'/);",
    "  assert.match(content, /runAt: 'document_end'/);\n"
    "  assert.doesNotMatch(content, /await getBackend\\(\\)/);\n"
    "  assert.match(content, /mountQuickBar\\(latestSettings\\)/);\n"
    "  assert.match(content, /ctx\\.locationWatcher\\.run\\(\\)/);\n"
    "  assert.match(content, /ctx\\.onInvalidated/);\n"
    "  assert.match(aiEmbed, /runAt: 'document_idle'/);\n"
    "  assert.match(aiEmbed, /ctx\\.onInvalidated/);",
    "content lifecycle tests",
)
Path("scripts/test-performance-surfaces.mjs").write_text(
    Path("scripts/test-performance-surfaces.mjs").read_text()
    + "\n\ntest('website bundle delegates data access to the background worker', () => {\n"
      "  assert.doesNotMatch(quickbar, /from '\\.\\/backend'/);\n"
      "  assert.doesNotMatch(quickbar, /from '\\.\\/bookmarks'/);\n"
      "  assert.match(quickbar, /KS_QUICKBAR_BOOTSTRAP/);\n"
      "  assert.match(quickbar, /KS_QUICKBAR_SEARCH/);\n"
      "});\n"
)

Path("scripts/check-bundle-budget.mjs").write_text("""import { stat, readdir } from 'node:fs/promises';
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
""")

replace_once(
    "package.json",
    '    "test:performance": "node --test scripts/test-performance-surfaces.mjs",\n    "test":',
    '    "test:performance": "node --test scripts/test-performance-surfaces.mjs",\n    "check:bundle": "node scripts/check-bundle-budget.mjs",\n    "test":',
    "bundle budget script",
)

replace_once(
    ".github/workflows/ci.yml",
    "      - name: Build Chrome Web Store ZIP\n        shell: bash",
    "      - name: Verify performance budgets\n        run: npm run check:bundle\n\n      - name: Build Chrome Web Store ZIP\n        shell: bash",
    "bundle budget CI step",
)

Path(__file__).unlink(missing_ok=True)
