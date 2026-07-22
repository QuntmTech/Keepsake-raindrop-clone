from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    file.write_text(source.replace(old, new, 1))


# Keyboard arrows move the inward resize edge in the direction pressed.
replace_once(
    "lib/quickbar.ts",
    "    if (event.key === 'ArrowLeft') next -= side === 'right' ? 2 : -2;\n    else if (event.key === 'ArrowRight') next += side === 'right' ? 2 : -2;",
    "    if (event.key === 'ArrowLeft') next += side === 'right' ? 2 : -2;\n"
    "    else if (event.key === 'ArrowRight') next += side === 'right' ? -2 : 2;",
    "keyboard resize direction",
)

# A missing record is 404; offline/timeouts must remain visible to queue safety.
replace_once(
    "lib/backend/pocketbase.ts",
    "    } catch {\n      return null;\n    }\n  }\n\n  async markVisited",
    "    } catch (error) {\n"
    "      if ((error as { status?: number })?.status === 404) return null;\n"
    "      throw error;\n"
    "    }\n"
    "  }\n\n"
    "  async markVisited",
    "findByUrl network distinction",
)

# Serialize Recall cache read-modify-write operations across concurrent tabs.
replace_once(
    "entrypoints/background.ts",
    "    recallCache.getValue().then((cache) => {\n      if (cache[tabId]) {\n        delete cache[tabId];\n        recallCache.setValue(cache);\n      }\n    });",
    "    mutateRecallCache((cache) => { delete cache[tabId]; }).catch(() => {});",
    "Recall removal lock",
)
replace_once(
    "entrypoints/background.ts",
    "const recallCache = storage.defineItem<Record<number, RecallResult>>('session:recall_cache', { fallback: {} });\n\nasync function runRecall",
    "const recallCache = storage.defineItem<Record<number, RecallResult>>('session:recall_cache', { fallback: {} });\n"
    "let recallCacheMutation: Promise<unknown> = Promise.resolve();\n"
    "function mutateRecallCache(mutator: (cache: Record<number, RecallResult>) => void): Promise<void> {\n"
    "  const next = recallCacheMutation.then(async () => {\n"
    "    const cache = await recallCache.getValue();\n"
    "    mutator(cache);\n"
    "    await recallCache.setValue(cache);\n"
    "  });\n"
    "  recallCacheMutation = next.catch(() => undefined);\n"
    "  return next;\n"
    "}\n\n"
    "async function runRecall",
    "Recall cache lock helper",
)
replace_once(
    "entrypoints/background.ts",
    "  const fresh = await recallCache.getValue();\n  fresh[tabId] = result;\n  await recallCache.setValue(fresh);",
    "  const liveTab = await browser.tabs.get(tabId).catch(() => null);\n"
    "  if (!liveTab || liveTab.url !== url) return;\n"
    "  await mutateRecallCache((cache) => { cache[tabId] = result; });",
    "Recall cache safe write",
)

# Keep the selected-text toolbar visible at every viewport edge.
replace_once(
    "entrypoints/content.ts",
    "  bar.style.top = `${window.scrollY + rect.top - 46}px`;\n  bar.style.left = `${window.scrollX + rect.left}px`;",
    "  const toolbarWidth = 150;\n"
    "  bar.style.top = `${Math.max(8, rect.top - 46)}px`;\n"
    "  bar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - toolbarWidth - 8))}px`;",
    "highlight toolbar viewport clamp",
)
replace_once(
    "entrypoints/content.ts",
    "    .ks-toolbar { position: absolute; z-index: 2147483647; display: flex; gap: 6px;",
    "    .ks-toolbar { position: fixed; z-index: 2147483647; display: flex; gap: 6px;",
    "fixed highlight toolbar",
)

# Update safety assertions for the queue and audit fixes.
replace_once(
    "scripts/test-reliability-safety.mjs",
    "  assert.match(queue, /queue\\.slice\\(-100\\)/);",
    "  assert.doesNotMatch(queue, /queue\\.slice\\(-100\\)/);\n"
    "  assert.match(queue, /remaining\\.push\\(item, \\.\\.\\.queue\\.slice\\(index \\+ 1\\)\\)/);",
    "queue preservation test",
)
Path("scripts/test-reliability-safety.mjs").write_text(
    Path("scripts/test-reliability-safety.mjs").read_text()
    + "\n\ntest('Recall cache writes are serialized and stale tabs cannot reappear', () => {\n"
      "  assert.match(background, /mutateRecallCache/);\n"
      "  assert.match(background, /liveTab\\.url !== url/);\n"
      "});\n"
)
Path("scripts/test-quickbar-tooltips.mjs").write_text(
    Path("scripts/test-quickbar-tooltips.mjs").read_text()
    + "\n\ntest('highlight toolbar stays inside the visible viewport', async () => {\n"
      "  const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');\n"
      "  assert.match(content, /position: fixed/);\n"
      "  assert.match(content, /window\\.innerWidth - toolbarWidth/);\n"
      "});\n"
)

Path(__file__).unlink(missing_ok=True)
