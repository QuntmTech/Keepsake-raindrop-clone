from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


root = Path(__file__).resolve().parents[1]

# ---- background: real Chrome toolbar popup + safe custom URL -----------------
background_path = root / "entrypoints/background.ts"
background = background_path.read_text()
background = replace_once(
    background,
    "import { storage } from 'wxt/utils/storage';",
    "import { storage } from 'wxt/utils/storage';\nimport { normalizeQuickBarUrl } from '@/lib/quickbarConfig';",
    "background import",
)
background = replace_once(
    background,
    "  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {\n    handleMessage(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));",
    "  browser.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {\n    handleMessage(msg, sender).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));",
    "message sender forwarding",
)
background = replace_once(
    background,
    "async function handleMessage(msg: Message): Promise<unknown> {",
    "async function handleMessage(msg: Message, sender?: { tab?: { id?: number; windowId?: number } }): Promise<unknown> {",
    "handleMessage signature",
)
background = replace_once(
    background,
    "    case 'OPEN_DASHBOARD':\n      await openDashboard();\n      return { ok: true };\n\n    case 'OPEN_SURFACE':\n      if (msg.surface === 'dashboard') await openDashboard();\n      else if (msg.surface === 'sidepanel') await openSidePanel();\n      return { ok: true };",
    "    case 'OPEN_DASHBOARD':\n      await openDashboard();\n      return { ok: true };\n\n    case 'OPEN_POPUP':\n      await openToolbarPopup(sender?.tab?.id, sender?.tab?.windowId);\n      return { ok: true };\n\n    case 'OPEN_URL': {\n      const url = normalizeQuickBarUrl(msg.url);\n      if (!url) return { ok: false, error: 'Only valid http:// or https:// URLs can be opened.' };\n      await browser.tabs.create({ url });\n      return { ok: true };\n    }\n\n    case 'OPEN_SURFACE':\n      if (msg.surface === 'dashboard') await openDashboard();\n      else if (msg.surface === 'sidepanel') await openSidePanel();\n      else await openToolbarPopup(sender?.tab?.id, sender?.tab?.windowId);\n      return { ok: true };",
    "popup/url message cases",
)
background = replace_once(
    background,
    "async function openDashboard() {",
    "async function openToolbarPopup(tabId?: number, windowId?: number) {\n  const action = browser.action as typeof browser.action & {\n    openPopup?: (options?: { windowId?: number }) => Promise<void>;\n  };\n  if (typeof action.openPopup !== 'function') {\n    throw new Error('Opening the toolbar dropdown requires Chrome 127 or newer.');\n  }\n\n  const currentPopup = await browser.action.getPopup({ tabId }).catch(() => '');\n  const needsTemporaryPopup = !currentPopup;\n  if (needsTemporaryPopup) await browser.action.setPopup({ popup: 'popup.html', tabId });\n\n  try {\n    await action.openPopup(windowId == null ? undefined : { windowId });\n  } finally {\n    if (needsTemporaryPopup) {\n      setTimeout(() => browser.action.setPopup({ popup: '', tabId }).catch(() => {}), 1000);\n    }\n  }\n}\n\nasync function openDashboard() {",
    "open popup helper",
)
background_path.write_text(background)

# ---- Quick Bar: popup button, drag ordering, color/size/custom shortcut ------
quickbar_path = root / "lib/quickbar.ts"
quickbar = quickbar_path.read_text()
quickbar = replace_once(
    quickbar,
    "import { clampQuickBarTop, quickBarFractionFromTop, quickBarSideForPointer } from './uiContext';\nimport { type Collection, type QuickBarSide, type Settings } from './types';",
    "import { clampQuickBarTop, quickBarFractionFromTop, quickBarSideForPointer } from './uiContext';\nimport { normalizeQuickBarColor, normalizeQuickBarOrder, normalizeQuickBarUrl, reorderQuickBarAction } from './quickbarConfig';\nimport { type Collection, type QuickBarAction, type QuickBarCustomIcon, type QuickBarSide, type Settings } from './types';",
    "quickbar imports",
)
quickbar = replace_once(
    quickbar,
    "  plus: '<path d=\"M12 5v14M5 12h14\"/>',",
    "  plus: '<path d=\"M12 5v14M5 12h14\"/>',\n  popup: '<rect x=\"4\" y=\"5\" width=\"16\" height=\"14\" rx=\"2\"/><path d=\"M4 9h16M8 7h.01M11 7h.01\"/>',\n  settings: '<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20h-3v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 6.6 15a1.7 1.7 0 0 0-1.56-1.04H5v-3h.08A1.7 1.7 0 0 0 6.64 9.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.34 4.7V4h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04H21v3h-.08A1.7 1.7 0 0 0 19.4 15z\"/>',\n  link: '<path d=\"M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15\"/><path d=\"M14 11a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20.07l1.15-1.15\"/>',\n  globe: '<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18\"/>',\n  bolt: '<path d=\"M13 2 4 14h7l-1 8 9-12h-7z\"/>',\n  star: '<path d=\"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z\"/>',",
    "quickbar icons",
)
quickbar = replace_once(
    quickbar,
    "  const settings = await getSettings();\n  const accent = ACCENTS.find((item) => item.key === settings.accent)?.swatch ?? '#2563eb';",
    "  const settings = await getSettings();\n  let currentSettings = settings;\n  let accent = normalizeQuickBarColor(settings.quickBarColor) || ACCENTS.find((item) => item.key === settings.accent)?.swatch || '#2563eb';",
    "quickbar mutable settings",
)
quickbar = replace_once(
    quickbar,
    "  host.id = 'keepsake-quickbar';\n  const shadow = host.attachShadow({ mode: 'open' });",
    "  host.id = 'keepsake-quickbar';\n  host.style.setProperty('--ks-accent', accent);\n  const shadow = host.attachShadow({ mode: 'open' });",
    "accent CSS variable",
)
quickbar = quickbar.replace("${accent}dd", "var(--ks-accent)")
quickbar = quickbar.replace("${accent}66", "var(--ks-accent)")
quickbar = quickbar.replace("${accent}", "var(--ks-accent)")
quickbar = replace_once(
    quickbar,
    "    .btn:disabled { opacity: .65; }",
    "    .btn:disabled { opacity: .65; }\n    .actions { display: flex; flex-direction: column; align-items: center; gap: 3px; }\n    .action[draggable=\"true\"] { cursor: grab; }\n    .action.dragging-action { opacity: .42; transform: scale(.9); }\n    .action.drop-target { outline: 2px solid var(--ks-accent); outline-offset: 2px; }\n    .rail.compact { padding: 5px 4px; gap: 2px; border-radius: 13px 0 0 13px; }\n    .rail.left.compact { border-radius: 0 13px 13px 0; }\n    .rail.compact .btn { width: 32px; height: 32px; border-radius: 9px; }\n    .rail.compact .mini, .rail.compact .grip { width: 32px; height: 19px; }",
    "dock action CSS",
)
quickbar = replace_once(
    quickbar,
    "    .msg { padding: 14px 12px; font-size: 13px; line-height: 1.45; color: rgba(255,255,255,.76); text-align: center; }",
    "    .msg { padding: 14px 12px; font-size: 13px; line-height: 1.45; color: rgba(255,255,255,.76); text-align: center; }\n    .config { display: flex; flex-direction: column; gap: 10px; padding: 5px; }\n    .config label { display: flex; flex-direction: column; gap: 5px; color: rgba(255,255,255,.72); font-size: 11px; font-weight: 650; }\n    .config input, .config select { width: 100%; border: 1px solid rgba(255,255,255,.13); border-radius: 8px; background: rgba(255,255,255,.07); color: #fff; padding: 8px; font: 12px ui-sans-serif,system-ui; outline: none; }\n    .config select option { color: #111; }\n    .config-actions, .chips { display: flex; gap: 6px; flex-wrap: wrap; }\n    .chip { flex: 1; min-width: 82px; border: 1px solid rgba(255,255,255,.13); border-radius: 8px; background: rgba(255,255,255,.07); color: #fff; padding: 7px 8px; cursor: pointer; font-size: 11px; }\n    .chip.active { border-color: var(--ks-accent); box-shadow: inset 0 0 0 1px var(--ks-accent); }\n    .swatch { width: 25px; height: 25px; border-radius: 50%; border: 2px solid rgba(255,255,255,.45); cursor: pointer; padding: 0; }\n    .hint { margin: 0; color: rgba(255,255,255,.48); font-size: 10px; line-height: 1.4; }\n    .primary-small { border: none; border-radius: 8px; background: var(--ks-accent); color: #fff; padding: 8px 10px; cursor: pointer; font-size: 11px; font-weight: 700; }",
    "dock settings CSS",
)
quickbar = replace_once(
    quickbar,
    "    <div class=\"grip\" role=\"button\" aria-label=\"Drag Quick Bar\" title=\"Drag up/down or across the screen to switch sides\">${icon('grip')}</div>\n    <button class=\"btn save\" type=\"button\" aria-label=\"Save this page\" title=\"Save this page\">${icon('bookmark', true)}</button>\n    <button class=\"btn folder\" type=\"button\" aria-label=\"Save to collection\" title=\"Save to collection\">${icon('folder')}</button>\n    <button class=\"btn dash\" type=\"button\" aria-label=\"Open Keepsake\" title=\"Open Keepsake\">${icon('grid')}</button>",
    "    <div class=\"grip\" role=\"button\" aria-label=\"Drag Quick Bar\" title=\"Drag up/down or across the screen to switch sides\">${icon('grip')}</div>\n    <div class=\"actions\">\n      <button class=\"btn action popup\" draggable=\"true\" data-action=\"popup\" type=\"button\" aria-label=\"Open Keepsake dropdown\" title=\"Open Keepsake dropdown\">${icon('popup')}</button>\n      <button class=\"btn action save\" draggable=\"true\" data-action=\"save\" type=\"button\" aria-label=\"Save this page\" title=\"Save this page\">${icon('bookmark', true)}</button>\n      <button class=\"btn action folder\" draggable=\"true\" data-action=\"folder\" type=\"button\" aria-label=\"Save to collection\" title=\"Save to collection\">${icon('folder')}</button>\n      <button class=\"btn action dash\" draggable=\"true\" data-action=\"dashboard\" type=\"button\" aria-label=\"Open Keepsake dashboard\" title=\"Open Keepsake dashboard\">${icon('grid')}</button>\n      <button class=\"btn action custom\" draggable=\"true\" data-action=\"custom\" type=\"button\" aria-label=\"Open custom shortcut\" title=\"Open custom shortcut\" hidden>${icon('link')}</button>\n    </div>\n    <button class=\"mini customize\" type=\"button\" aria-label=\"Customize Quick Bar\" title=\"Customize Quick Bar\">${icon('settings', false, 17)}</button>",
    "dock HTML",
)
quickbar = replace_once(
    quickbar,
    "  const saveButton = rail.querySelector('.btn.save') as HTMLButtonElement;\n  const folderButton = rail.querySelector('.btn.folder') as HTMLButtonElement;\n  const dashboardButton = rail.querySelector('.btn.dash') as HTMLButtonElement;",
    "  const actions = rail.querySelector('.actions') as HTMLDivElement;\n  const popupButton = rail.querySelector('.btn.popup') as HTMLButtonElement;\n  const saveButton = rail.querySelector('.btn.save') as HTMLButtonElement;\n  const folderButton = rail.querySelector('.btn.folder') as HTMLButtonElement;\n  const dashboardButton = rail.querySelector('.btn.dash') as HTMLButtonElement;\n  const customButton = rail.querySelector('.btn.custom') as HTMLButtonElement;\n  const customizeButton = rail.querySelector('.customize') as HTMLButtonElement;",
    "dock button queries",
)
quickbar = replace_once(
    quickbar,
    "  const updateFromSettings = (next: Settings) => {\n    currentY = next.quickBarY;\n    side = next.quickBarSide;\n    collapsed = next.quickBarCollapsed;\n    applyAll();\n  };",
    "  const renderActions = () => {\n    const order = normalizeQuickBarOrder(currentSettings.quickBarOrder);\n    const map: Record<QuickBarAction, HTMLButtonElement> = {\n      popup: popupButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,\n    };\n    for (const action of order) actions.appendChild(map[action]);\n    const customUrl = normalizeQuickBarUrl(currentSettings.quickBarCustomUrl);\n    customButton.hidden = !customUrl;\n    const iconName = currentSettings.quickBarCustomIcon as QuickBarCustomIcon;\n    customButton.innerHTML = icon(iconName in SVG ? iconName as keyof typeof SVG : 'link');\n    customButton.title = currentSettings.quickBarCustomLabel.trim() || 'Open custom shortcut';\n    rail.classList.toggle('compact', currentSettings.quickBarSize === 'compact');\n  };\n\n  const updateFromSettings = (next: Settings) => {\n    currentSettings = next;\n    currentY = next.quickBarY;\n    side = next.quickBarSide;\n    collapsed = next.quickBarCollapsed;\n    accent = normalizeQuickBarColor(next.quickBarColor) || ACCENTS.find((item) => item.key === next.accent)?.swatch || '#2563eb';\n    host.style.setProperty('--ks-accent', accent);\n    renderActions();\n    applyAll();\n  };",
    "dock settings update",
)
quickbar = replace_once(
    quickbar,
    "  applyAll();",
    "  renderActions();\n  applyAll();",
    "initial render actions",
)
quickbar = replace_once(
    quickbar,
    "  const onDocumentClick = (event: MouseEvent) => {",
    "  let draggedAction: QuickBarAction | null = null;\n  for (const button of [popupButton, saveButton, folderButton, dashboardButton, customButton]) {\n    button.addEventListener('dragstart', (event) => {\n      draggedAction = button.dataset.action as QuickBarAction;\n      button.classList.add('dragging-action');\n      event.dataTransfer?.setData('text/plain', draggedAction);\n      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';\n    });\n    button.addEventListener('dragend', () => {\n      draggedAction = null;\n      button.classList.remove('dragging-action');\n      for (const item of actions.querySelectorAll('.drop-target')) item.classList.remove('drop-target');\n    });\n    button.addEventListener('dragover', (event) => {\n      if (!draggedAction) return;\n      event.preventDefault();\n      button.classList.add('drop-target');\n    });\n    button.addEventListener('dragleave', () => button.classList.remove('drop-target'));\n    button.addEventListener('drop', async (event) => {\n      event.preventDefault();\n      button.classList.remove('drop-target');\n      const target = button.dataset.action as QuickBarAction;\n      const source = draggedAction || event.dataTransfer?.getData('text/plain') as QuickBarAction;\n      if (!source || source === target) return;\n      const nextOrder = reorderQuickBarAction(currentSettings.quickBarOrder, source, target);\n      updateFromSettings(await setSettings({ quickBarOrder: nextOrder }));\n    });\n  }\n\n  const onDocumentClick = (event: MouseEvent) => {",
    "dock drag ordering",
)
quickbar = replace_once(
    quickbar,
    "  saveButton.onclick = () => quickSave();\n  folderButton.onclick = () => (popover ? closePopover() : openFolders());\n  dashboardButton.onclick = () => send({ type: 'OPEN_DASHBOARD' });",
    "  async function openDropdown() {\n    try {\n      const response = await send<{ ok?: boolean; error?: string }>({ type: 'OPEN_POPUP' });\n      if (!response?.ok) throw new Error(response?.error || 'The dropdown could not be opened');\n    } catch (error) {\n      showMessage((error as Error)?.message || 'Keepsake could not open the dropdown.');\n    }\n  }\n\n  async function openCustomShortcut() {\n    const url = normalizeQuickBarUrl(currentSettings.quickBarCustomUrl);\n    if (!url) {\n      showMessage('Add a valid custom URL in Quick Bar settings first.');\n      return;\n    }\n    const response = await send<{ ok?: boolean; error?: string }>({ type: 'OPEN_URL', url }).catch(() => null);\n    if (!response?.ok) showMessage(response?.error || 'The custom shortcut could not be opened.');\n  }\n\n  function openCustomize() {\n    closePopover();\n    popover = buildPopover();\n    const heading = document.createElement('h4');\n    heading.textContent = 'Customize Quick Bar';\n    popover.appendChild(heading);\n    const form = document.createElement('div');\n    form.className = 'config';\n\n    const hint = document.createElement('p');\n    hint.className = 'hint';\n    hint.textContent = 'Drag the four action buttons directly on the dock to reorder them.';\n    form.appendChild(hint);\n\n    const sizeWrap = document.createElement('div');\n    sizeWrap.className = 'chips';\n    for (const size of ['compact', 'comfortable'] as const) {\n      const button = document.createElement('button');\n      button.type = 'button';\n      button.className = `chip ${currentSettings.quickBarSize === size ? 'active' : ''}`;\n      button.textContent = size === 'compact' ? 'Compact' : 'Comfortable';\n      button.onclick = async () => {\n        updateFromSettings(await setSettings({ quickBarSize: size }));\n        openCustomize();\n      };\n      sizeWrap.appendChild(button);\n    }\n    form.appendChild(sizeWrap);\n\n    const colorLabel = document.createElement('label');\n    colorLabel.textContent = 'Dock color';\n    const colors = document.createElement('div');\n    colors.className = 'chips';\n    const palette = ['', '#2563eb', '#7c3aed', '#059669', '#e11d48', '#ea580c', '#111827'];\n    for (const color of palette) {\n      const swatch = document.createElement('button');\n      swatch.type = 'button';\n      swatch.className = 'swatch';\n      swatch.title = color || 'Follow app accent';\n      swatch.style.background = color || ACCENTS.find((item) => item.key === currentSettings.accent)?.swatch || '#2563eb';\n      swatch.onclick = async () => {\n        updateFromSettings(await setSettings({ quickBarColor: color }));\n        openCustomize();\n      };\n      colors.appendChild(swatch);\n    }\n    const picker = document.createElement('input');\n    picker.type = 'color';\n    picker.value = normalizeQuickBarColor(currentSettings.quickBarColor) || accent;\n    picker.title = 'Choose any color';\n    picker.style.width = '38px';\n    picker.style.padding = '2px';\n    picker.onchange = async () => updateFromSettings(await setSettings({ quickBarColor: picker.value }));\n    colors.appendChild(picker);\n    colorLabel.appendChild(colors);\n    form.appendChild(colorLabel);\n\n    const urlLabel = document.createElement('label');\n    urlLabel.textContent = 'Custom shortcut URL (optional)';\n    const urlInput = document.createElement('input');\n    urlInput.placeholder = 'example.com or https://example.com';\n    urlInput.value = currentSettings.quickBarCustomUrl;\n    urlLabel.appendChild(urlInput);\n    form.appendChild(urlLabel);\n\n    const labelWrap = document.createElement('label');\n    labelWrap.textContent = 'Shortcut name';\n    const labelInput = document.createElement('input');\n    labelInput.maxLength = 40;\n    labelInput.value = currentSettings.quickBarCustomLabel;\n    labelWrap.appendChild(labelInput);\n    form.appendChild(labelWrap);\n\n    const iconWrap = document.createElement('label');\n    iconWrap.textContent = 'Shortcut icon';\n    const iconSelect = document.createElement('select');\n    for (const name of ['link', 'globe', 'bolt', 'star'] as QuickBarCustomIcon[]) {\n      const option = document.createElement('option');\n      option.value = name;\n      option.textContent = name[0].toUpperCase() + name.slice(1);\n      option.selected = currentSettings.quickBarCustomIcon === name;\n      iconSelect.appendChild(option);\n    }\n    iconWrap.appendChild(iconSelect);\n    form.appendChild(iconWrap);\n\n    const buttons = document.createElement('div');\n    buttons.className = 'config-actions';\n    const reset = document.createElement('button');\n    reset.type = 'button';\n    reset.className = 'chip';\n    reset.textContent = 'Reset order';\n    reset.onclick = async () => {\n      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'save', 'folder', 'dashboard', 'custom'] }));\n      openCustomize();\n    };\n    const save = document.createElement('button');\n    save.type = 'button';\n    save.className = 'primary-small';\n    save.textContent = 'Save customization';\n    save.onclick = async () => {\n      const entered = urlInput.value.trim();\n      const normalized = normalizeQuickBarUrl(entered);\n      if (entered && !normalized) {\n        showMessage('That shortcut URL is not valid. Use an http:// or https:// address.');\n        return;\n      }\n      updateFromSettings(await setSettings({\n        quickBarCustomUrl: normalized,\n        quickBarCustomLabel: labelInput.value.trim() || 'Open shortcut',\n        quickBarCustomIcon: iconSelect.value as QuickBarCustomIcon,\n      }));\n      closePopover();\n    };\n    buttons.append(reset, save);\n    form.appendChild(buttons);\n    popover.appendChild(form);\n    shadow.appendChild(popover);\n  }\n\n  popupButton.onclick = openDropdown;\n  saveButton.onclick = () => quickSave();\n  folderButton.onclick = () => (popover ? closePopover() : openFolders());\n  dashboardButton.onclick = () => send({ type: 'OPEN_DASHBOARD' });\n  customButton.onclick = openCustomShortcut;\n  customizeButton.onclick = () => (popover ? closePopover() : openCustomize());",
    "dock actions and customization",
)
quickbar_path.write_text(quickbar)

# ---- version + tests ---------------------------------------------------------
package_path = root / "package.json"
package = package_path.read_text().replace('"version": "8.10.1"', '"version": "8.10.2"', 1)
package = package.replace(
    '"test:ui": "node --test scripts/test-ui-context.mjs",\n    "test": "npm run test:retrieval && npm run test:bulk && npm run test:ui"',
    '"test:ui": "node --test scripts/test-ui-context.mjs",\n    "test:quickbar": "node --test scripts/test-quickbar-config.mjs",\n    "test": "npm run test:retrieval && npm run test:bulk && npm run test:ui && npm run test:quickbar"',
    1,
)
package_path.write_text(package)

config_path = root / "wxt.config.ts"
config = config_path.read_text().replace("version: '8.10.1'", "version: '8.10.2'", 1)
config_path.write_text(config)

# Remove this one-shot generator and its workflow from the final branch.
(root / ".github/workflows/quickbar-generate.yml").unlink(missing_ok=True)
Path(__file__).unlink(missing_ok=True)
