from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    file.write_text(source.replace(old, new, 1))


replace_once(
    "lib/messaging.ts",
    "import { type HighlightColor } from './types';",
    "import { type HighlightColor, type TextQuoteAnchor } from './types';",
    "highlight anchor message type",
)
replace_once(
    "lib/messaging.ts",
    "  | { type: 'KS_PAGE_NAVIGATED'; url: string } // background -> content after SPA history navigation\n",
    "  | { type: 'KS_PAGE_NAVIGATED'; url: string } // background -> content after SPA history navigation\n"
    "  | { type: 'KS_HIGHLIGHT_CREATE'; url: string; text: string; color: HighlightColor; anchor?: TextQuoteAnchor }\n"
    "  | { type: 'KS_HIGHLIGHTS_FOR_URL'; url: string }\n",
    "highlight RPC messages",
)

replace_once(
    "entrypoints/background.ts",
    "import { requestSidepanelTarget } from '@/lib/sidepanelTarget';",
    "import { requestSidepanelTarget } from '@/lib/sidepanelTarget';\nimport { createHighlight, highlightsForUrl } from '@/lib/highlights';",
    "background highlight imports",
)
replace_once(
    "entrypoints/background.ts",
    "    case 'KS_QUICKBAR_BOOTSTRAP': {",
    "    case 'KS_HIGHLIGHT_CREATE': {\n"
    "      if (sender?.tab?.url && !sameCanonicalUrl(sender.tab.url, msg.url)) {\n"
    "        return { ok: false, error: 'The page changed before the highlight was saved.' };\n"
    "      }\n"
    "      const highlight = await createHighlight({\n"
    "        url: msg.url,\n"
    "        text: msg.text.slice(0, 20_000),\n"
    "        color: msg.color,\n"
    "        anchor: msg.anchor,\n"
    "      });\n"
    "      return { ok: true, highlight };\n"
    "    }\n\n"
    "    case 'KS_HIGHLIGHTS_FOR_URL': {\n"
    "      if (sender?.tab?.url && !sameCanonicalUrl(sender.tab.url, msg.url)) {\n"
    "        return { ok: false, highlights: [], error: 'The page changed.' };\n"
    "      }\n"
    "      const highlights = await highlightsForUrl(msg.url);\n"
    "      return { ok: true, highlights };\n"
    "    }\n\n"
    "    case 'KS_QUICKBAR_BOOTSTRAP': {",
    "background highlight handlers",
)

replace_once(
    "entrypoints/content.ts",
    "import { createHighlight, highlightsForUrl, parseAnchor } from '@/lib/highlights';\n",
    "",
    "content highlight backend import",
)
replace_once(
    "entrypoints/content.ts",
    "import { type HighlightColor, type TextQuoteAnchor } from '@/lib/types';",
    "import { type Highlight, type HighlightColor, type TextQuoteAnchor } from '@/lib/types';",
    "content highlight record type",
)
replace_once(
    "entrypoints/content.ts",
    "      if (message.type === 'KS_PAGE_NAVIGATED') {\n        capturedSelection = null;\n        selectionUndo = null;\n        quickBar?.refreshPage();\n        return undefined;\n      }",
    "      if (message.type === 'KS_PAGE_NAVIGATED') {\n"
    "        capturedSelection = null;\n"
    "        selectionUndo = null;\n"
    "        quickBar?.refreshPage();\n"
    "        if (latestSettings.enableHighlights) {\n"
    "          clearAppliedHighlights();\n"
    "          ctx.setTimeout(() => reapplyHighlights().catch(() => {}), 300);\n"
    "        }\n"
    "        return undefined;\n"
    "      }",
    "SPA highlight refresh",
)
replace_once(
    "entrypoints/content.ts",
    "async function saveSelection(text: string, anchor: TextQuoteAnchor, color: HighlightColor) {\n  const { text: full, segs } = buildIndex();\n  const start = locate(full, anchor);\n  if (start >= 0) wrapRange(start, text.length, segs, full, COLORS[color]);\n  try {\n    await createHighlight({ url: location.href, text, color, anchor });\n  } catch {\n    /* visual highlight remains for this session */\n  }\n}\n\nasync function reapplyHighlights() {\n  try {\n    const saved = await highlightsForUrl(location.href);\n    for (const highlight of saved) {\n      const { text: full, segs } = buildIndex();\n      const anchor = parseAnchor(highlight.anchor) ?? { exact: highlight.text };\n      const start = locate(full, anchor);\n      if (start >= 0) wrapRange(start, anchor.exact.length, segs, full, COLORS[highlight.color]);\n    }\n  } catch {\n    /* not logged in or offline */\n  }\n}",
    "function parseAnchor(raw?: string): TextQuoteAnchor | null {\n"
    "  if (!raw) return null;\n"
    "  try { return JSON.parse(raw) as TextQuoteAnchor; } catch { return null; }\n"
    "}\n\n"
    "function clearAppliedHighlights() {\n"
    "  for (const mark of document.querySelectorAll('mark.ks-highlight')) {\n"
    "    const parent = mark.parentNode;\n"
    "    mark.replaceWith(document.createTextNode(mark.textContent ?? ''));\n"
    "    parent?.normalize();\n"
    "  }\n"
    "}\n\n"
    "async function saveSelection(text: string, anchor: TextQuoteAnchor, color: HighlightColor) {\n"
    "  const pageUrl = location.href;\n"
    "  const { text: full, segs } = buildIndex();\n"
    "  const start = locate(full, anchor);\n"
    "  if (start >= 0) wrapRange(start, text.length, segs, full, COLORS[color]);\n"
    "  await browser.runtime.sendMessage({\n"
    "    type: 'KS_HIGHLIGHT_CREATE',\n"
    "    url: pageUrl,\n"
    "    text,\n"
    "    color,\n"
    "    anchor,\n"
    "  }).catch(() => null);\n"
    "}\n\n"
    "async function reapplyHighlights() {\n"
    "  const pageUrl = location.href;\n"
    "  const response = (await browser.runtime\n"
    "    .sendMessage({ type: 'KS_HIGHLIGHTS_FOR_URL', url: pageUrl })\n"
    "    .catch(() => null)) as { ok?: boolean; highlights?: Highlight[] } | null;\n"
    "  if (!response?.ok || location.href !== pageUrl) return;\n"
    "  for (const highlight of response.highlights ?? []) {\n"
    "    const { text: full, segs } = buildIndex();\n"
    "    const anchor = parseAnchor(highlight.anchor) ?? { exact: highlight.text };\n"
    "    const start = locate(full, anchor);\n"
    "    if (start >= 0) wrapRange(start, anchor.exact.length, segs, full, COLORS[highlight.color]);\n"
    "  }\n"
    "}",
    "background-backed highlight persistence",
)

replace_once(
    "scripts/test-performance-surfaces.mjs",
    "  assert.doesNotMatch(quickbar, /from '\\.\\/bookmarks'/);",
    "  assert.doesNotMatch(quickbar, /from '\\.\\/bookmarks'/);\n"
    "  assert.doesNotMatch(content, /@\\/lib\\/highlights/);\n"
    "  assert.match(content, /KS_HIGHLIGHTS_FOR_URL/);",
    "highlight bundle test",
)
Path("scripts/test-reliability-safety.mjs").write_text(
    Path("scripts/test-reliability-safety.mjs").read_text()
    + "\n\ntest('highlight storage stays out of the every-page bundle', () => {\n"
      "  assert.doesNotMatch(content, /@\\/lib\\/highlights/);\n"
      "  assert.match(background, /KS_HIGHLIGHT_CREATE/);\n"
      "  assert.match(background, /KS_HIGHLIGHTS_FOR_URL/);\n"
      "});\n"
)

Path(__file__).unlink(missing_ok=True)
