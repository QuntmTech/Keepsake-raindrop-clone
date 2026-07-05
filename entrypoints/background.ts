import { getBackend } from '@/lib/backend';
import { getSettings, watchSettings } from '@/lib/settings';
import { saveBookmark } from '@/lib/bookmarks';
import { enqueueSave, flushQueue } from '@/lib/queue';
import { type Message, type ScreenshotResult, type MetaResult, dataUrlToBlob } from '@/lib/messaging';
import { extractPageMeta, type PageMeta } from '@/lib/metadata';
import { captureFullPageScript } from '@/lib/fullpage';
import {
  IDLE_RECORDING_STATE,
  recordingStateStore,
  screenshotFilename,
  type RecordOptions,
} from '@/lib/capture';
import { inferType, safeDomain } from '@/lib/util';
import { type UiSurface } from '@/lib/types';
import { migrateToSaves, pruneStudioItems, stashStudioItem } from '@/lib/save';
import { saveCaptureToLibrary } from '@/lib/captureSave';
import { searchBookmarks, updateBookmark } from '@/lib/bookmarks';
import { agoLabel, autofileSave, findDuplicate, undoFiling, type FiledResult } from '@/lib/autofile';
import { processQueueTick, scheduleQueue, QUEUE_ALARM } from '@/lib/aiQueue';
import { matchPage, recallAllowed, type RecallResult } from '@/lib/recall';
import { ensureOffscreen } from '@/lib/embedder';
import { checkOnVisit, scheduleWatchAlarm, startWatch, stopWatch, watchTick, WATCH_ALARM, type WatchConfig } from '@/lib/watch';
import { onboardingStage } from '@/lib/onboarding';
import { applyOverlayWrite, applyOverlayForget, syncHomeOverlay } from '@/lib/home';
import { canSaveBookmark, storageRemaining } from '@/lib/entitlements';
import { storage } from 'wxt/utils/storage';

// The background "service worker" is event-driven and can be killed at any time by Chrome.
// Never rely on long-lived in-memory state here — read from storage when you need it.

// Renew the auth token twice a day so sessions never hard-expire server-side.
const AUTH_REFRESH_ALARM = 'ks-auth-refresh';
function scheduleAuthRefresh(): void {
  browser.alarms.create(AUTH_REFRESH_ALARM, { periodInMinutes: 720, delayInMinutes: 5 });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    // First-ever install: open Home with the sign-up form + guided tour queued.
    // Updates/reloads never touch the stage, so existing users aren't nagged.
    if (details.reason === 'install') {
      await onboardingStage.setValue('fresh').catch(() => {});
      browser.tabs.create({ url: browser.runtime.getURL('/newtab.html') }).catch(() => {});
    }
    await ensureContextMenu();
    const settings = await getSettings();
    await applyActionBehavior(settings.primarySurface);
    await flushQueue().catch(() => {});
    scheduleQueue();
    scheduleWatchAlarm();
    scheduleAuthRefresh();
    await runMigration();
    syncHomeOverlay().catch(() => {});
  });

  browser.runtime.onStartup?.addListener(async () => {
    const settings = await getSettings();
    await applyActionBehavior(settings.primarySurface);
    await flushQueue().catch(() => {});
    scheduleQueue();
    scheduleWatchAlarm();
    scheduleAuthRefresh();
    await runMigration();
    syncHomeOverlay().catch(() => {});
  });

  // Batch AI queue + Living Bookmarks scheduler. Alarms are re-registered on
  // install/startup, so watches survive browser restarts.
  browser.alarms?.onAlarm.addListener(async (alarm) => {
    if (alarm.name === QUEUE_ALARM) {
      processQueueTick().catch(() => {});
      // Offline saves land within a minute of connectivity returning, even if
      // the service worker never received an 'online' event.
      flushQueue().catch(() => {});
    }
    if (alarm.name === WATCH_ALARM) {
      // The watch fetch/parse runs in the offscreen document — make sure it exists.
      await ensureOffscreenDocument().catch(() => {});
      watchTick().catch(() => {});
    }
    if (alarm.name === AUTH_REFRESH_ALARM) {
      // Keep long-lived sessions alive even if the user never opens a surface
      // (the refresh itself is throttled through storage, so this is cheap).
      const backend = await getBackend().catch(() => null);
      await backend?.renewAuthToken?.().catch(() => {});
    }
  });

  // Plan-limit notifications (buttons: "See Pro plans") — one action, any
  // button index opens the options page where upgrading will live (Phase 3).
  browser.notifications?.onButtonClicked.addListener(async (notifId) => {
    if (!notifId.startsWith('ks-upgrade-')) return;
    await browser.runtime.openOptionsPage();
    browser.notifications?.clear(notifId).catch(() => {});
  });

  // "Filed: …" notification actions (buttons: Undo / View).
  browser.notifications?.onButtonClicked.addListener(async (notifId, buttonIndex) => {
    const map = await filedNotifs.getValue();
    const saveId = map[notifId];
    if (!saveId) return;
    if (buttonIndex === 0) {
      await undoFiling(saveId).catch(() => {});
      notify('Moved to Inbox', 'The save was un-filed. It stays tagged and searchable.');
    } else {
      await openDashboard();
    }
    browser.notifications?.clear(notifId).catch(() => {});
    delete map[notifId];
    await filedNotifs.setValue(map);
  });

  // Re-apply icon behavior whenever the user changes the primary surface.
  watchSettings((s) => applyActionBehavior(s.primarySurface));

  // Flush the offline queue when connectivity returns.
  self.addEventListener('online', () => {
    flushQueue().catch(() => {});
  });

  // Toolbar icon click (only fires when no popup is set).
  browser.action.onClicked.addListener(async (tab) => {
    const { primarySurface } = await getSettings();
    if (primarySurface === 'sidepanel') await openSidePanel(tab.id);
    else if (primarySurface === 'dashboard') await openDashboard();
  });

  // Keyboard shortcuts (see wxt.config.ts → commands).
  browser.commands?.onCommand.addListener(async (command) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (command === 'save-page' && tab) await saveTab(tab);
    else if (command === 'open-dashboard') await openDashboard();
    else if (command === 'quick-save' && tab?.id) {
      // Ask the in-page Quick Bar to pop its folder picker.
      browser.tabs.sendMessage(tab.id, { type: 'OPEN_QUICKBAR' }).catch(() => {});
    }
  });

  // Right-click context menu.
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'save-to-vault' && tab) await saveTab(tab);
  });

  // Message hub.
  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    handleMessage(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep the channel open for the async response
  });

  // ── Ambient Recall (Phase 2) ──────────────────────────────────────────────
  // On navigation, match the page against the library — locally only — and
  // show a per-tab badge. Debounced per tab+URL; opt-in via Settings.
  browser.webNavigation?.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return;
    runRecall(details.tabId, details.url).catch(() => {});
    // JS-rendered watched pages re-check from the live DOM on visit.
    checkOnVisit(details.tabId, details.url).catch(() => {});
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    recallCache.getValue().then((cache) => {
      if (cache[tabId]) {
        delete cache[tabId];
        recallCache.setValue(cache);
      }
    });
  });
});

// Per-tab recall results; session-scoped so the side panel can read them and
// nothing persists across browser restarts.
const recallCache = storage.defineItem<Record<number, RecallResult>>('session:recall_cache', { fallback: {} });

async function runRecall(tabId: number, url: string): Promise<void> {
  if (!(await recallAllowed(url))) return;
  const cache = await recallCache.getValue();
  const prev = cache[tabId];
  if (prev && prev.url === url && Date.now() - prev.checkedAt < 60_000) return; // debounce SPA re-fires

  // Cheap page signals only: tab title + meta description. No page read.
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab || tab.url !== url) return;
  let description: string | undefined;
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId },
      func: () => document.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute('content') ?? '',
    });
    description = (res?.result as string) || undefined;
  } catch {
    /* protected page — title alone still matches */
  }

  const result = await matchPage({ url, title: tab.title, description });
  const fresh = await recallCache.getValue();
  fresh[tabId] = result;
  await recallCache.setValue(fresh);

  // Badge: count of related saves; exact matches get the distinct green.
  try {
    if (result.total > 0) {
      await browser.action.setBadgeText({ text: String(result.total), tabId });
      await browser.action.setBadgeBackgroundColor({ color: result.exact.length ? '#16a34a' : '#6366f1', tabId });
    } else {
      await browser.action.setBadgeText({ text: '', tabId });
    }
  } catch {
    /* tab gone */
  }
}

async function handleMessage(msg: Message): Promise<unknown> {
  await getBackend(); // restore session
  switch (msg.type) {
    case 'PING':
      return { ok: true };

    case 'CAPTURE_SCREENSHOT': {
      const dataUrl = await captureVisibleTab();
      return { dataUrl } satisfies ScreenshotResult;
    }

    case 'EXTRACT_META': {
      const meta = await extractMeta(msg.tabId);
      return { meta } satisfies MetaResult;
    }

    case 'SAVE_CURRENT_PAGE': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) await saveTab(tab, msg.collection);
      return { ok: true };
    }

    case 'OPEN_DASHBOARD':
      await openDashboard();
      return { ok: true };

    case 'OPEN_SURFACE':
      if (msg.surface === 'dashboard') await openDashboard();
      else if (msg.surface === 'sidepanel') await openSidePanel();
      return { ok: true };

    case 'FLUSH_QUEUE': {
      const n = await flushQueue();
      return { ok: true, flushed: n };
    }

    // Side panel asks for the current tab's Ambient Recall matches.
    case 'KS_GET_RECALL': {
      let tabId = msg.tabId;
      if (tabId == null) {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      const cache = await recallCache.getValue();
      return { ok: true, result: tabId != null ? cache[tabId] ?? null : null };
    }

    // ---- Living Bookmarks (Phase 3) ----
    case 'KS_WATCH_START': {
      await startWatch(msg.saveId, msg.cfg);
      return { ok: true };
    }
    case 'KS_WATCH_STOP': {
      await stopWatch(msg.saveId);
      return { ok: true };
    }
    // Element picker: the user points at the price/section to watch.
    case 'KS_PICK_SELECTOR': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: 'No active tab' };
      const [res] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: pickElementOnPage,
      });
      return { ok: true, selector: (res?.result as string) || null };
    }

    // Popup/dialog saves hand the AI pass to the background (it owns the
    // offscreen embedder and survives the popup closing).
    case 'KS_AUTOFILE': {
      const result = await autofileSave(msg.id, { tabId: msg.tabId }).catch(() => null);
      if (result) await announceFiling(result);
      return { ok: true, result };
    }

    // Home overlay single-writer: every context funnels overlay mutations here
    // so the background's one lock serializes them (see lib/home.ts).
    case 'KS_OVERLAY_WRITE':
      await applyOverlayWrite(msg.user, msg.id, msg.dropped, msg.verified);
      return { ok: true };

    case 'KS_OVERLAY_FORGET':
      await applyOverlayForget(msg.user, msg.id);
      return { ok: true };

    // ---- capture: screenshots + screen recording (ported from CaptureCraft) ----
    // Every capture lands in the Capture Studio tab: edit/annotate screenshots,
    // preview/trim recordings, then copy/download/save from there.

    case 'KS_CAPTURE_VISIBLE': {
      const dataUrl = await browser.tabs.captureVisibleTab(undefined as any, { format: 'png' });
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await openStudio({
        kind: 'screenshot',
        blob: dataUrlToBlob(dataUrl),
        pageUrl: tab?.url,
        pageTitle: tab?.title,
        filename: screenshotFilename('visible'),
      });
      return { ok: true };
    }

    // One tile for the injected full-page script. Chrome caps captureVisibleTab
    // at ~2 calls/second — pace ourselves so a long page never hits the quota.
    case 'KS_CAPTURE_VIEWPORT': {
      await tileGate();
      const dataUrl = await browser.tabs.captureVisibleTab(undefined as any, { format: 'png' });
      return { dataUrl };
    }

    case 'KS_CAPTURE_FULL': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { ok: false, error: 'No active tab' };
      // Ack immediately so the popup can close — the capture keeps running.
      captureFullPage(tab.id).catch((e) => notify('Full-page capture failed', String((e as Error)?.message ?? e)));
      return { ok: true };
    }

    case 'KS_START_RECORDING':
      await startRecording(msg.options);
      return { ok: true };

    case 'KS_STOP_RECORDING': {
      const resp = (await browser.runtime
        .sendMessage({ target: 'ks-offscreen', type: 'OFFSCREEN_STOP' })
        .catch(() => null)) as { ok?: boolean } | null;
      if (!resp?.ok) {
        // The recorder is gone (crashed / never started) — clear the stuck
        // state instead of pretending the stop worked.
        await recordingStateStore.setValue(IDLE_RECORDING_STATE);
        await browser.action.setBadgeText({ text: '' });
      }
      return { ok: true };
    }

    case 'KS_GET_RECORDING_STATE':
      return await verifiedRecordingState();

    // Offscreen finished: the blob: URL it minted stays valid while the
    // offscreen document is alive, so pull the bytes before closing anything.
    case 'KS_RECORDING_READY': {
      const prior = await recordingStateStore.getValue();
      await recordingStateStore.setValue(IDLE_RECORDING_STATE);
      await browser.action.setBadgeText({ text: '' });
      try {
        const blob = await (await fetch(msg.url)).blob();
        const tab = prior.tabId ? await browser.tabs.get(prior.tabId).catch(() => null) : null;
        await openStudio({
          kind: 'recording',
          blob,
          pageUrl: tab?.url ?? undefined,
          pageTitle: tab?.title ?? undefined,
          filename: msg.filename,
          durationMs: msg.durationMs,
        });
        return { ok: true };
      } catch {
        // Couldn't park the recording for the studio — fall back to a plain
        // download so the bytes are never lost.
        try {
          await browser.downloads.download({ url: msg.url, filename: msg.filename });
          return { ok: true };
        } catch {
          return { ok: false }; // offscreen falls back to an in-document anchor download
        }
      }
    }

    case 'KS_RECORDING_ERROR': {
      await recordingStateStore.setValue(IDLE_RECORDING_STATE);
      await browser.action.setBadgeText({ text: '' });
      notify('Recording failed', msg.error);
      return { ok: true };
    }

    default:
      return { ok: false, error: 'unknown message' };
  }
}

// Mirror the vault into the IndexedDB Save store (idempotent, additive; the
// legacy chrome.storage stores get a one-time versioned backup first).
async function runMigration() {
  await migrateToSaves(() => searchBookmarks('', { perPage: 2000, homeTiles: 'include' })).catch(() => 0);
  await pruneStudioItems().catch(() => {});
}

// ---- capture plumbing ----

// Minimum spacing between captureVisibleTab calls (Chrome quota ≈ 2/sec).
let lastTileAt = 0;
async function tileGate(): Promise<void> {
  const MIN_GAP = 600;
  const wait = lastTileAt + MIN_GAP - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastTileAt = Date.now();
}

// Run the scroll-and-stitch capture and return the stitched image data URL.
async function grabFullPageDataUrl(tabId: number): Promise<string | null> {
  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: captureFullPageScript,
  });
  return (res?.result as string | null) ?? null;
}

async function captureFullPage(tabId: number): Promise<void> {
  const dataUrl = await grabFullPageDataUrl(tabId);
  if (!dataUrl) throw new Error('Capture returned nothing');
  const filename = screenshotFilename('full').replace(/\.png$/, dataUrl.startsWith('data:image/jpeg') ? '.jpg' : '.png');
  const tab = await browser.tabs.get(tabId).catch(() => null);
  await openStudio({
    kind: 'screenshot',
    blob: dataUrlToBlob(dataUrl),
    pageUrl: tab?.url ?? undefined,
    pageTitle: tab?.title ?? undefined,
    filename,
  });
}

// Park a fresh capture in IndexedDB (it also lands in the library right away),
// then open the Capture Studio tab on it for editing/preview.
async function openStudio(opts: {
  kind: 'screenshot' | 'recording';
  blob: Blob;
  pageUrl?: string;
  pageTitle?: string;
  filename: string;
  durationMs?: number;
}): Promise<void> {
  const result = await saveCaptureToLibrary(opts).catch(() => undefined);
  const id = await stashStudioItem({ ...opts, saveId: result?.saveId });
  await browser.tabs.create({ url: browser.runtime.getURL('/studio.html') + `#${id}` });
  // A recording that was kept local-only (Free plan) still downloads/edits
  // fine — only cross-device sync was withheld. Tell the user once, with a
  // path to upgrade, instead of silently doing something they didn't expect.
  if (opts.kind === 'recording' && result && !result.cloudSaved) {
    notifyUpgrade(
      'ks-upgrade-recording-',
      'Recording saved on this device',
      'Upgrade to Pro to sync recordings to your library across devices.',
    );
  }
}

// Offscreen creation is shared with the embedder/watcher: lib/embedder.ts
// exports the single memoized creator (one offscreen document per extension).
const ensureOffscreenDocument = ensureOffscreen;

async function startRecording(options: RecordOptions): Promise<void> {
  const state = await verifiedRecordingState();
  if (state.isRecording) throw new Error('Already recording');
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');

  await ensureOffscreenDocument();

  let streamId: string;
  if (options.mode === 'tab') {
    streamId = await new Promise<string>((resolve, reject) => {
      browser.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id: string) => {
        if (id) resolve(id);
        else reject(new Error(browser.runtime.lastError?.message || 'Could not capture this tab'));
      });
    });
  } else {
    // Chrome's picker: user chooses a screen or a window (audio = system audio).
    // NO target tab here: a tab-scoped streamId can only be consumed by that
    // tab, but our consumer is the offscreen recorder — omitting the tab keys
    // the stream to the extension itself (getUserMedia in offscreen works).
    streamId = await new Promise<string>((resolve, reject) => {
      browser.desktopCapture.chooseDesktopMedia(['screen', 'window', 'audio'] as any, (id: string) => {
        if (id) resolve(id);
        else reject(new Error('Capture was cancelled'));
      });
    });
  }

  // The offscreen recorder can fail to start (bad streamId, no encoder…) —
  // surface that instead of pretending the recording is running.
  const started = (await browser.runtime.sendMessage({
    target: 'ks-offscreen',
    type: 'OFFSCREEN_START',
    streamId,
    options,
  })) as { ok?: boolean; error?: string } | null;
  if (!started?.ok) throw new Error(started?.error || 'The recorder could not start');
  await recordingStateStore.setValue({
    isRecording: true,
    mode: options.mode,
    startedAt: Date.now(),
    tabId: tab.id,
  });
  await browser.action.setBadgeText({ text: 'REC' });
  await browser.action.setBadgeBackgroundColor({ color: '#dc2626' });
}

// Storage says "recording", but is the offscreen recorder actually alive?
// The offscreen document itself is NOT proof — the embedder/recall/watcher
// keep one alive constantly — so ask the recorder for its real state.
async function verifiedRecordingState() {
  const state = await recordingStateStore.getValue();
  if (!state.isRecording) return state;
  const contexts = await (browser.runtime as any).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  let live = false;
  if (contexts.length > 0) {
    const resp = (await browser.runtime
      .sendMessage({ target: 'ks-offscreen', type: 'OFFSCREEN_GET_STATE' })
      .catch(() => null)) as { ok?: boolean; recording?: boolean } | null;
    live = Boolean(resp?.recording);
  }
  if (!live) {
    await recordingStateStore.setValue(IDLE_RECORDING_STATE);
    await browser.action.setBadgeText({ text: '' });
    return IDLE_RECORDING_STATE;
  }
  return state;
}

function notify(title: string, message: string) {
  browser.notifications
    ?.create({ type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title, message })
    .catch(() => {});
}

// A plan-limit notice with a single "See Pro plans" action. idPrefix must be
// one of the ks-upgrade-* prefixes the onButtonClicked handler recognizes.
function notifyUpgrade(idPrefix: string, title: string, message: string) {
  browser.notifications
    ?.create(`${idPrefix}${Date.now()}`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title,
      message,
      buttons: [{ title: 'See Pro plans' }],
    })
    .catch(() => {});
}

async function captureVisibleTab(): Promise<string> {
  return browser.tabs.captureVisibleTab(undefined as any, { format: 'jpeg', quality: 70 });
}

// Inject the self-contained extractor into a tab and return its result.
async function extractMeta(tabId?: number): Promise<PageMeta | null> {
  let id = tabId;
  if (!id) {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    id = tab?.id;
  }
  if (!id) return null;
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId: id },
      func: extractPageMeta,
    });
    return (res?.result as PageMeta) ?? null;
  } catch {
    return null; // chrome:// pages, PDF viewer, etc. block injection
  }
}

// Map of "Filed: …" notification id → save id (session-scoped; survives SW restarts).
const filedNotifs = storage.defineItem<Record<string, string>>('session:filed_notifs', { fallback: {} });

// Full save pipeline used by the context menu + keyboard shortcut.
// Phase 1 UX: dedupe → INSTANT save → background AI pass (extract/embed/file)
// → "Filed: …" notification with Undo. The user never waits on AI.
async function saveTab(tab: chrome.tabs.Tab, collection?: string) {
  if (!tab.url) return;
  await getBackend();
  const settings = await getSettings();

  // Dedupe by canonical URL — surface the existing save instead of duplicating.
  // An explicitly picked folder (Quick Bar / context) still gets honored by
  // moving the existing save there.
  const dup = await findDuplicate(tab.url).catch(() => undefined);
  if (dup) {
    if (collection) {
      await updateBookmark(dup.id, { collection }).catch(() => {});
      await flash('✓', '#16a34a');
      notify('Already saved — moved', `You saved this ${agoLabel(dup.timestamps.createdAt)}; it's now in the folder you picked.`);
    } else {
      await flash('∃', '#6366f1');
      notify('Already saved', `You saved this ${agoLabel(dup.timestamps.createdAt)}. Open the dashboard to view it.`);
    }
    return;
  }

  // Cloud bookmark cap (Free plan) — a guardrail only; PocketBase enforces the
  // real limit server-side. Checked AFTER dedupe: filing an existing save into
  // a different folder is never blocked by the cap, only genuinely new saves.
  const cap = await canSaveBookmark();
  if (!cap.allowed) {
    await flash('★', '#f59e0b');
    notifyUpgrade(
      'ks-upgrade-bookmarks-',
      "You've reached your Free plan's bookmark limit",
      `${cap.used}/${cap.limit} cloud bookmarks used. Upgrade to Pro for unlimited bookmarks, hosted AI, and more.`,
    );
    return;
  }

  const meta = settings.enableMetadata ? await extractMeta(tab.id) : null;

  let screenshotBlob: Blob | undefined;
  if (settings.enableAutoScreenshot) {
    // Storage guardrail: skip only the preview image when the estimated cloud
    // storage cap is tight — the save itself always proceeds.
    const storageState = await storageRemaining();
    if (storageState.unlimited || storageState.remaining === null || storageState.remaining > 0) {
      try {
        screenshotBlob = dataUrlToBlob(await captureVisibleTab());
      } catch {
        /* capture can fail on protected pages — save anyway */
      }
    }
  }

  const input = {
    url: tab.url,
    title: meta?.title || tab.title || tab.url,
    description: meta?.description,
    content: meta?.text,
    collection: collection ?? settings.defaultCollection,
    cover: meta?.cover,
    favicon: meta?.favicon,
    domain: safeDomain(tab.url),
    type: meta?.type ?? inferType(tab.url),
    readingTime: meta?.readingTime,
    screenshotBlob,
  };

  let saved;
  try {
    saved = await saveBookmark(input);
    await flash('✓', '#16a34a');
  } catch {
    await enqueueSave(input);
    await flash('…', '#f59e0b'); // queued offline
    return;
  }

  // Background AI pass — embed locally, auto-file. Awaited so the service
  // worker stays alive, but the save above already succeeded. The metadata
  // extracted above is passed through so the page isn't re-injected.
  const result = await autofileSave(saved.id, { tabId: tab.id, meta }).catch(() => null);
  if (result) await announceFiling(result);
}

async function announceFiling(result: FiledResult) {
  if (result.status === 'unprocessed' || result.status === 'kept') return;
  const where = result.collectionName ?? 'Inbox';
  const tags = result.tags.filter((t) => t !== 'unprocessed').slice(0, 4).join(', ');
  const id = await browser.notifications
    ?.create(`ks-filed-${result.saveId}-${Date.now()}`, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: result.status === 'inbox' ? 'Saved to Inbox' : `Filed: ${where}`,
      message: tags ? `Tags: ${tags}` : 'Saved to your library',
      buttons: [{ title: 'Undo (move to Inbox)' }, { title: 'View' }],
    })
    .catch(() => null);
  if (id) {
    const map = await filedNotifs.getValue();
    map[id] = result.saveId;
    await filedNotifs.setValue(map);
  }
}

async function flash(text: string, color: string) {
  await browser.action.setBadgeText({ text });
  await browser.action.setBadgeBackgroundColor({ color });
  setTimeout(() => browser.action.setBadgeText({ text: '' }), 1600);
}

async function openDashboard() {
  const url = browser.runtime.getURL('/dashboard.html');
  // Focus an existing dashboard tab if one is open, else create it.
  const tabs = await browser.tabs.query({ url });
  if (tabs[0]?.id) await browser.tabs.update(tabs[0].id, { active: true });
  else await browser.tabs.create({ url });
}

async function openSidePanel(tabId?: number) {
  try {
    let id = tabId;
    if (!id) {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      id = tab?.id;
    }
    // @ts-expect-error - sidePanel types vary by @types/chrome version
    await browser.sidePanel.open({ tabId: id });
  } catch {
    /* not available */
  }
}

async function applyActionBehavior(surface: UiSurface) {
  if (surface === 'popup') await browser.action.setPopup({ popup: 'popup.html' });
  else await browser.action.setPopup({ popup: '' }); // empty => onClicked fires

  try {
    await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    /* not available in this browser */
  }
}

// "Point at the price" picker — injected into the page, fully self-contained.
// Highlights hovered elements; click resolves a stable CSS selector; Esc cancels.
function pickElementOnPage(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #6366f1;background:rgba(99,102,241,.12);border-radius:4px;transition:all .06s';
    const hint = document.createElement('div');
    hint.style.cssText =
      'position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:99px;font:13px system-ui;box-shadow:0 4px 14px rgba(0,0,0,.3)';
    hint.textContent = 'Click the price / section to watch — Esc to cancel';
    document.body.append(overlay, hint);

    const cssPath = (el: Element): string => {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.body && parts.length < 6) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift(`#${CSS.escape(node.id)}`);
          break;
        }
        const cls = [...node.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c)).slice(0, 2);
        if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
        const parent: Element | null = node.parentElement;
        if (parent) {
          const same = [...parent.children].filter((c) => c.tagName === node!.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ');
    };

    let current: Element | null = null;
    const move = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === overlay || el === hint) return;
      current = el;
      const r = el.getBoundingClientRect();
      overlay.style.left = `${r.left}px`;
      overlay.style.top = `${r.top}px`;
      overlay.style.width = `${r.width}px`;
      overlay.style.height = `${r.height}px`;
    };
    const finish = (value: string | null) => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      overlay.remove();
      hint.remove();
      resolve(value);
    };
    const click = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      finish(current ? cssPath(current) : null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(null);
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    setTimeout(() => finish(null), 60_000); // never hang the message channel
  });
}

async function ensureContextMenu() {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: 'save-to-vault',
    title: 'Save page to Keepsake',
    contexts: ['page', 'link', 'selection'],
  });
}
