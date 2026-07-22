from pathlib import Path

FILES = {
    "types": Path("lib/types.ts"),
    "config": Path("lib/quickbarConfig.ts"),
    "messaging": Path("lib/messaging.ts"),
    "quickbar": Path("lib/quickbar.ts"),
    "background": Path("entrypoints/background.ts"),
    "config_test": Path("scripts/test-quickbar-config.mjs"),
    "tooltip_test": Path("scripts/test-quickbar-tooltips.mjs"),
}


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one {label}, found {count}")
    return source.replace(old, new, 1)


def update(key: str, changes: list[tuple[str, str, str]]) -> None:
    path = FILES[key]
    source = path.read_text()
    for old, new, label in changes:
        source = replace_once(source, old, new, label)
    path.write_text(source)


update("types", [
    (
        "export type QuickBarAction = 'popup' | 'search' | 'browse' | 'related' | 'save' | 'folder' | 'dashboard' | 'custom';",
        "export type QuickBarAction = 'popup' | 'search' | 'browse' | 'ai' | 'related' | 'save' | 'folder' | 'dashboard' | 'custom';",
        "QuickBarAction union",
    ),
    (
        "  quickBarOrder: ['popup', 'search', 'browse', 'related', 'save', 'folder', 'dashboard', 'custom'],",
        "  quickBarOrder: ['popup', 'search', 'browse', 'ai', 'related', 'save', 'folder', 'dashboard', 'custom'],",
        "default Quick Bar order",
    ),
])

update("config", [
    (
        "  'browse',\n  'related',",
        "  'browse',\n  'ai',\n  'related',",
        "default AI action",
    ),
    (
        "  for (const action of ['search', 'browse', 'related'] as QuickBarAction[]) {",
        "  for (const action of ['search', 'browse', 'ai', 'related'] as QuickBarAction[]) {",
        "legacy AI action migration",
    ),
])

update("messaging", [
    (
        "  | { type: 'OPEN_QUICKBAR' } // background -> content: pop the quick-save folder picker\n",
        "  | { type: 'OPEN_QUICKBAR' } // background -> content: pop the quick-save folder picker\n  | { type: 'OPEN_AI_TOOLS' } // Quick Bar -> side panel AI Writer\n",
        "OPEN_AI_TOOLS message",
    ),
])

update("quickbar", [
    (
        "  search: '<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-4-4\"/>',\n",
        "  search: '<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-4-4\"/>',\n  sparkles: '<path d=\"M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z\"/>',\n",
        "sparkles icon",
    ),
    (
        "      <button class=\"btn action browse\" draggable=\"true\" data-action=\"browse\" type=\"button\" aria-label=\"Browse collections\" data-tooltip=\"Browse collections\">${icon('library')}</button>\n      <button class=\"btn action related\"",
        "      <button class=\"btn action browse\" draggable=\"true\" data-action=\"browse\" type=\"button\" aria-label=\"Browse collections\" data-tooltip=\"Browse collections\">${icon('library')}</button>\n      <button class=\"btn action ai\" draggable=\"true\" data-action=\"ai\" type=\"button\" aria-label=\"Open AI Writer\" data-tooltip=\"AI Writer\">${icon('sparkles')}</button>\n      <button class=\"btn action related\"",
        "AI button markup",
    ),
    (
        "  const browseButton = rail.querySelector('.btn.browse') as HTMLButtonElement;\n  const relatedButton = rail.querySelector('.btn.related') as HTMLButtonElement;",
        "  const browseButton = rail.querySelector('.btn.browse') as HTMLButtonElement;\n  const aiButton = rail.querySelector('.btn.ai') as HTMLButtonElement;\n  const relatedButton = rail.querySelector('.btn.related') as HTMLButtonElement;",
        "AI button query",
    ),
    (
        "      popup: popupButton, search: searchButton, browse: browseButton, related: relatedButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,",
        "      popup: popupButton, search: searchButton, browse: browseButton, ai: aiButton, related: relatedButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,",
        "AI action map",
    ),
    (
        "  for (const button of [popupButton, searchButton, browseButton, relatedButton, saveButton, folderButton, dashboardButton, customButton]) {",
        "  for (const button of [popupButton, searchButton, browseButton, aiButton, relatedButton, saveButton, folderButton, dashboardButton, customButton]) {",
        "AI draggable action",
    ),
    (
        "      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'search', 'browse', 'related', 'save', 'folder', 'dashboard', 'custom'] }));",
        "      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'search', 'browse', 'ai', 'related', 'save', 'folder', 'dashboard', 'custom'] }));",
        "AI reset order",
    ),
    (
        "  browseButton.onclick = openCollectionLauncher;\n  relatedButton.onclick = openRelated;",
        "  browseButton.onclick = openCollectionLauncher;\n  aiButton.onclick = async () => {\n    const response = await send<{ ok?: boolean; error?: string }>({ type: 'OPEN_AI_TOOLS' }).catch(() => null);\n    if (!response?.ok) showMessage(response?.error || 'Keepsake could not open AI Writer.');\n  };\n  relatedButton.onclick = openRelated;",
        "AI click handler",
    ),
])

update("background", [
    (
        "import { normalizeQuickBarUrl, resolveSaveCollection, sameCanonicalUrl } from '@/lib/quickbarConfig';\n",
        "import { normalizeQuickBarUrl, resolveSaveCollection, sameCanonicalUrl } from '@/lib/quickbarConfig';\nimport { requestSidepanelTarget } from '@/lib/sidepanelTarget';\n",
        "sidepanel target import",
    ),
    (
        "    case 'OPEN_URL': {",
        "    case 'OPEN_AI_TOOLS':\n      await requestSidepanelTarget('ai');\n      await openSidePanel(sender?.tab?.id);\n      return { ok: true };\n\n    case 'OPEN_URL': {",
        "OPEN_AI_TOOLS handler",
    ),
])

update("config_test", [
    (
        "const completeOrder = ['popup', 'search', 'browse', 'related', 'save', 'folder', 'dashboard', 'custom'];",
        "const completeOrder = ['popup', 'search', 'browse', 'ai', 'related', 'save', 'folder', 'dashboard', 'custom'];",
        "complete AI order",
    ),
    (
        "    'folder', 'popup', 'search', 'browse', 'related', 'save', 'dashboard', 'custom',",
        "    'folder', 'popup', 'search', 'browse', 'ai', 'related', 'save', 'dashboard', 'custom',",
        "legacy AI order",
    ),
    (
        "    normalizeQuickBarOrder(['dashboard', 'save', 'popup', 'related', 'folder', 'browse', 'search', 'custom']),\n    ['dashboard', 'save', 'popup', 'related', 'folder', 'browse', 'search', 'custom'],",
        "    normalizeQuickBarOrder(['dashboard', 'save', 'popup', 'related', 'folder', 'ai', 'browse', 'search', 'custom']),\n    ['dashboard', 'save', 'popup', 'related', 'folder', 'ai', 'browse', 'search', 'custom'],",
        "complete custom AI order",
    ),
    (
        "    ['popup', 'search', 'browse', 'related', 'dashboard', 'save', 'folder', 'custom'],",
        "    ['popup', 'search', 'browse', 'ai', 'related', 'dashboard', 'save', 'folder', 'custom'],",
        "AI reorder expectation",
    ),
])

update("tooltip_test", [
    (
        "    'Browse collections',\n    'Save page',",
        "    'Browse collections',\n    'AI Writer',\n    'Save page',",
        "AI tooltip coverage",
    ),
])

Path(__file__).unlink(missing_ok=True)
