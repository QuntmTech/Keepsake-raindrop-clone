from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one {label}, found {count}")
    file.write_text(source.replace(old, new, 1))


# Supported SPA navigation signal instead of WXT private internals.
replace_once(
    "lib/messaging.ts",
    "  | { type: 'OPEN_QUICKBAR' } // background -> content: pop the quick-save folder picker\n",
    "  | { type: 'OPEN_QUICKBAR' } // background -> content: pop the quick-save folder picker\n"
    "  | { type: 'KS_PAGE_NAVIGATED'; url: string } // background -> content after SPA history navigation\n",
    "SPA navigation message",
)
replace_once(
    "entrypoints/background.ts",
    "  browser.webNavigation?.onCompleted.addListener((details) => {\n    if (details.frameId !== 0) return;\n    runRecall(details.tabId, details.url).catch(() => {});\n    // JS-rendered watched pages re-check from the live DOM on visit.\n    checkOnVisit(details.tabId, details.url).catch(() => {});\n  });",
    "  browser.webNavigation?.onCompleted.addListener((details) => {\n"
    "    if (details.frameId !== 0) return;\n"
    "    runRecall(details.tabId, details.url).catch(() => {});\n"
    "    // JS-rendered watched pages re-check from the live DOM on visit.\n"
    "    checkOnVisit(details.tabId, details.url).catch(() => {});\n"
    "  });\n"
    "  browser.webNavigation?.onHistoryStateUpdated.addListener((details) => {\n"
    "    if (details.frameId !== 0) return;\n"
    "    browser.tabs.sendMessage(details.tabId, { type: 'KS_PAGE_NAVIGATED', url: details.url }).catch(() => {});\n"
    "    runRecall(details.tabId, details.url).catch(() => {});\n"
    "    checkOnVisit(details.tabId, details.url).catch(() => {});\n"
    "  });",
    "SPA navigation background bridge",
)
replace_once(
    "entrypoints/content.ts",
    "      if (message.type === 'OPEN_QUICKBAR') {\n        ensureQuickBar().then((api) => api?.openFolders()).catch(() => {});\n        return undefined;\n      }\n      if (message.type === 'KS_AI_SELECTION_GET')",
    "      if (message.type === 'OPEN_QUICKBAR') {\n"
    "        ensureQuickBar().then((api) => api?.openFolders()).catch(() => {});\n"
    "        return undefined;\n"
    "      }\n"
    "      if (message.type === 'KS_PAGE_NAVIGATED') {\n"
    "        capturedSelection = null;\n"
    "        selectionUndo = null;\n"
    "        quickBar?.refreshPage();\n"
    "        return undefined;\n"
    "      }\n"
    "      if (message.type === 'KS_AI_SELECTION_GET')",
    "SPA navigation content handler",
)
replace_once(
    "entrypoints/content.ts",
    "    ctx.locationWatcher.run();\n    ctx.addEventListener(window, 'wxt:locationchange', () => {\n      capturedSelection = null;\n      selectionUndo = null;\n      quickBar?.refreshPage();\n    });\n",
    "",
    "private WXT location watcher",
)
replace_once(
    "entrypoints/content.ts",
    "    window.setTimeout(() => reapplyHighlights().catch(() => {}), 350);",
    "    ctx.setTimeout(() => reapplyHighlights().catch(() => {}), 350);",
    "highlight restoration context timer",
)
replace_once(
    "scripts/test-performance-surfaces.mjs",
    "  assert.match(content, /ctx\\.locationWatcher\\.run\\(\\)/);",
    "  assert.match(content, /KS_PAGE_NAVIGATED/);",
    "SPA test expectation",
)

# Queue mutations serialize, repeated clicks coalesce, and ambiguous creates dedupe.
Path("lib/queue.ts").write_text("""import { storage } from 'wxt/utils/storage';
import { findByUrl, saveBookmark, updateBookmark, type SaveBookmarkInput } from './bookmarks';

// Offline save queue. If a save fails transiently (offline, timeout, server down),
// stash the request and retry later. Queue writes are serialized because several
// extension surfaces may save at once while the MV3 worker is awake.
type QueuedSave = Omit<SaveBookmarkInput, 'screenshotBlob'> & { queuedAt: number };

const queueStore = storage.defineItem<QueuedSave[]>('local:save_queue', { fallback: [] });
let queueMutation: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(work: () => Promise<T>): Promise<T> {
  const next = queueMutation.then(work, work);
  queueMutation = next.catch(() => undefined);
  return next;
}

function sameDestination(a: QueuedSave, b: Omit<SaveBookmarkInput, 'screenshotBlob'>): boolean {
  return a.url === b.url && (a.collection ?? '') === (b.collection ?? '');
}

export async function enqueueSave(input: SaveBookmarkInput): Promise<void> {
  const { screenshotBlob, ...rest } = input;
  void screenshotBlob;
  await withQueueLock(async () => {
    const queue = await queueStore.getValue();
    const existing = queue.findIndex((item) => sameDestination(item, rest));
    const next = { ...rest, queuedAt: Date.now() };
    if (existing >= 0) queue[existing] = next;
    else queue.push(next);
    await queueStore.setValue(queue.slice(-100));
  });
}

export async function queueLength(): Promise<number> {
  return (await queueStore.getValue()).length;
}

// Attempt to flush everything. A prior timed-out create may actually have landed
// server-side, so check by URL before replaying it. This makes reconnect retries
// idempotent even before the backend gains client_uuid support.
export async function flushQueue(): Promise<number> {
  return withQueueLock(async () => {
    const queue = await queueStore.getValue();
    if (queue.length === 0) return 0;

    const remaining: QueuedSave[] = [];
    let saved = 0;
    let dropped = 0;
    for (const item of queue) {
      try {
        const { queuedAt, ...input } = item;
        void queuedAt;
        const existing = await findByUrl(input.url).catch(() => null);
        if (existing) {
          const destination = input.collection ?? '';
          if ((existing.collection ?? '') !== destination) {
            await updateBookmark(existing.id, { collection: destination });
          }
          saved++;
          continue;
        }
        await saveBookmark(input);
        saved++;
      } catch (error) {
        const status = (error as { status?: number })?.status ?? 0;
        // Permanent client failures can never recover. Timeout/network/429/5xx
        // remain queued; a later URL check prevents duplicate ambiguous creates.
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) dropped++;
        else remaining.push(item);
      }
    }
    await queueStore.setValue(remaining);
    if (dropped) console.warn(`[keepsake] dropped ${dropped} queued save(s) permanently rejected by the server`);
    return saved;
  });
}

export function watchQueue(cb: (n: number) => void): () => void {
  return queueStore.watch((value) => cb((value ?? []).length));
}
""")

# Never replay an atomic create batch after an ambiguous timeout.
replace_once(
    "lib/backend/pocketbase.ts",
    "    // A request with no timeout can hang a surface forever on a dead\n    // connection — abort at 30s so failures surface and the retry logic runs.",
    "    // A dead connection must not freeze a popup or page action. Abort each\n    // attempt after 8s; safe reads/updates get one bounded retry.",
    "PocketBase timeout comment",
)
replace_once(
    "lib/backend/pocketbase.ts",
    "      } catch {\n        // Batch unsupported/rejected — per-item so one bad row can't lose the chunk.\n        for (const input of slice) {",
    "      } catch (error) {\n"
    "        const status = (error as { status?: number })?.status ?? 0;\n"
    "        // Replay as individual creates only when the server definitively\n"
    "        // rejected the batch shape. Network/timeout/429/5xx is ambiguous: the\n"
    "        // atomic batch may have committed, so replaying could duplicate rows.\n"
    "        if (![400, 404, 405, 422].includes(status)) throw error;\n"
    "        for (const input of slice) {",
    "safe bulk fallback",
)

# Save actions have bounded enrichment and queue only genuinely transient errors.
replace_once(
    "entrypoints/background.ts",
    "// Full save pipeline used by the context menu + keyboard shortcut.",
    "async function settleWithin<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {\n"
    "  let timer: ReturnType<typeof setTimeout> | undefined;\n"
    "  try {\n"
    "    return await Promise.race([\n"
    "      promise.catch(() => fallback),\n"
    "      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), timeoutMs); }),\n"
    "    ]);\n"
    "  } finally {\n"
    "    if (timer) clearTimeout(timer);\n"
    "  }\n"
    "}\n\n"
    "// Full save pipeline used by the context menu + keyboard shortcut.",
    "save deadline helper",
)
replace_once(
    "entrypoints/background.ts",
    "  const [meta, screenshotBlob] = await Promise.all([metaPromise, screenshotPromise]);",
    "  const [meta, screenshotBlob] = await Promise.all([\n"
    "    settleWithin(metaPromise, 1800, null),\n"
    "    settleWithin(screenshotPromise, 1800, undefined),\n"
    "  ]);",
    "bounded save enrichment",
)
replace_once(
    "entrypoints/background.ts",
    "    await enqueueSave(input);\n    await flash('…', '#f59e0b');\n    return { ok: true, status: 'queued', title: input.title, collection: input.collection };",
    "    const status = (error as { status?: number })?.status ?? 0;\n"
    "    const transient = status === 0 || status === 408 || status === 429 || status >= 500;\n"
    "    if (!transient) {\n"
    "      await flash('!', '#dc2626');\n"
    "      return {\n"
    "        ok: false,\n"
    "        status: 'blocked',\n"
    "        error: (error as Error)?.message || 'The server rejected this save.',\n"
    "      };\n"
    "    }\n"
    "    await enqueueSave(input);\n"
    "    await flash('…', '#f59e0b');\n"
    "    return { ok: true, status: 'queued', title: input.title, collection: input.collection };",
    "transient-only save queue",
)

# Static regression guards for the new safety contracts.
Path("scripts/test-reliability-safety.mjs").write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const background = await readFile(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = await readFile(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const queue = await readFile(new URL('../lib/queue.ts', import.meta.url), 'utf8');
const pocketbase = await readFile(new URL('../lib/backend/pocketbase.ts', import.meta.url), 'utf8');

test('SPA changes use the supported webNavigation bridge', () => {
  assert.match(background, /onHistoryStateUpdated/);
  assert.match(background, /KS_PAGE_NAVIGATED/);
  assert.match(content, /KS_PAGE_NAVIGATED/);
  assert.doesNotMatch(content, /locationWatcher/);
});

test('offline queue serializes mutations and deduplicates ambiguous creates', () => {
  assert.match(queue, /withQueueLock/);
  assert.match(queue, /findByUrl\(input\.url\)/);
  assert.match(queue, /sameDestination/);
  assert.match(queue, /queue\.slice\(-100\)/);
});

test('create operations are not replayed after ambiguous failures', () => {
  assert.match(pocketbase, /\[400, 404, 405, 422\]\.includes\(status\)/);
  assert.match(pocketbase, /bookmarks'\)\.create\(form\), 0/);
});

test('save UX bounds enrichment and queues transient failures only', () => {
  assert.match(background, /settleWithin\(metaPromise, 1800, null\)/);
  assert.match(background, /status === 408/);
  assert.match(background, /status: 'blocked'/);
});
""")
replace_once(
    "package.json",
    '    "test:performance": "node --test scripts/test-performance-surfaces.mjs",\n    "check:bundle":',
    '    "test:performance": "node --test scripts/test-performance-surfaces.mjs",\n    "test:reliability": "node --test scripts/test-reliability-safety.mjs",\n    "check:bundle":',
    "reliability test script",
)
replace_once(
    "package.json",
    "npm run test:ai-upgrade && npm run test:performance\"",
    "npm run test:ai-upgrade && npm run test:performance && npm run test:reliability\"",
    "reliability test chain",
)

Path(__file__).unlink(missing_ok=True)
