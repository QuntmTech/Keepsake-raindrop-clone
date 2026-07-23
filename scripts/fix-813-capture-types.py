from pathlib import Path

MENU = Path('components/CaptureMenu.tsx')
BACKGROUND = Path('entrypoints/background.ts')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one {label}, found {count}')
    return source.replace(old, new, 1)

menu = MENU.read_text()
menu = replace_once(
    menu,
    "    const tick = () => {\n      const pausedNow = rec.paused && rec.pausedAt ? Date.now() - rec.pausedAt : 0;\n      const seconds = Math.max(0, Math.floor((Date.now() - rec.startedAt - rec.pausedDurationMs - pausedNow) / 1000));",
    "    const startedAt = rec.startedAt;\n    const tick = () => {\n      const pausedNow = rec.paused && rec.pausedAt ? Date.now() - rec.pausedAt : 0;\n      const seconds = Math.max(0, Math.floor((Date.now() - startedAt - rec.pausedDurationMs - pausedNow) / 1000));",
    'non-null recording start time',
)
MENU.write_text(menu)

background = BACKGROUND.read_text()
background = replace_once(
    background,
    "// Minimum spacing between captureVisibleTab calls (Chrome quota is roughly 2/sec).\nlet lastTileAt = 0;",
    "// Minimum spacing between captureVisibleTab calls (Chrome quota is roughly 2/sec).\nfunction captureTabPng(windowId?: number): Promise<string> {\n  return windowId == null\n    ? browser.tabs.captureVisibleTab({ format: 'png' })\n    : browser.tabs.captureVisibleTab(windowId, { format: 'png' });\n}\n\nlet lastTileAt = 0;",
    'typed capture helper',
)
background = replace_once(
    background,
    "        const dataUrl = await browser.tabs.captureVisibleTab(sender?.tab?.windowId, { format: 'png' });",
    "        const dataUrl = await captureTabPng(sender?.tab?.windowId);",
    'viewport capture overload',
)
background = replace_once(
    background,
    "    last = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });",
    "    last = await captureTabPng(windowId);",
    'validated capture overload',
)
BACKGROUND.write_text(background)

Path(__file__).unlink(missing_ok=True)
