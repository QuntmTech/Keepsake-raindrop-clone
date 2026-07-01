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
import { migrateToSaves } from '@/lib/save';
import { saveCaptureToLibrary } from '@/lib/captureSave';
import { searchBookmarks } from '@/lib/bookmarks';
import { agoLabel, autofileSave, findDuplicate, undoFiling, type FiledResult } from '@/lib/autofile';
import { processQueueTick, scheduleQueue, QUEUE_ALARM } from '@/lib/aiQueue';
import { storage } from 'wxt/utils/storage';

// The background "service worker" is event-driven and can be killed at any time by Chrome.
// Never rely on long-lived in-memory state here — read from storage when you need it.

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    await ensureContextMenu();
    const settings = await getSettings();
    await applyActionBehavior(settings.primarySurface);
    await flushQueue().catch(() => {});
    scheduleQueue();
    await runMigration();
  });

  browser.runtime.onStartup?.addListener(async () => {
    const settings = await getSettings();
    await applyActionBehavior(settings.primarySurface);
    await flushQueue().catch(() => {});
    scheduleQueue();
    await runMigration();
  });

  // Batch AI queue: embeds + files anything the instant save path missed.
  browser.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === QUEUE_ALARM) processQueueTick().catch(() => {});
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
});

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

    // Popup/dialog saves hand the AI pass to the background (it owns the
    // offscreen embedder and survives the popup closing).
    case 'KS_AUTOFILE' as never: {
      const m = msg as unknown as { id: string; tabId?: number };
      const result = await autofileSave(m.id, { tabId: m.tabId }).catch(() => null);
      if (result) await announceFiling(result);
      return { ok: true, result };
    }

    // ---- capture: screenshots + screen recording (ported from CaptureCraft) ----

    case 'KS_CAPTURE_VISIBLE': {
      const dataUrl = await browser.tabs.captureVisibleTab(undefined as any, { format: 'png' });
      const filename = screenshotFilename('visible');
      await browser.downloads.download({ url: dataUrl, filename });
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      saveCaptureToLibrary({
        kind: 'screenshot',
        blob: dataUrlToBlob(dataUrl),
        pageUrl: tab?.url,
        pageTitle: tab?.title,
        filename,
      }).catch(() => {});
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

    case 'KS_STOP_RECORDING':
      await browser.runtime.sendMessage({ target: 'ks-offscreen', type: 'OFFSCREEN_STOP' });
      return { ok: true };

    case 'KS_GET_RECORDING_STATE':
      return await verifiedRecordingState();

    // Offscreen finished: the blob: URL it minted stays valid while the
    // offscreen document is alive, so download it before closing anything.
    case 'KS_RECORDING_READY': {
      const prior = await recordingStateStore.getValue();
      await recordingStateStore.setValue(IDLE_RECORDING_STATE);
      await browser.action.setBadgeText({ text: '' });
      // The blob: URL resolves same-origin while the offscreen document lives —
      // pull the bytes now so the recording also lands in the library.
      try {
        const blob = await (await fetch(msg.url)).blob();
        const tab = prior.tabId ? await browser.tabs.get(prior.tabId).catch(() => null) : null;
        saveCaptureToLibrary({
          kind: 'recording',
          blob,
          pageUrl: tab?.url,
          pageTitle: tab?.title,
          filename: msg.filename,
          durationMs: msg.durationMs,
        }).catch(() => {});
      } catch {
        /* library copy is best-effort — the download below still happens */
      }
      try {
        await browser.downloads.download({ url: msg.url, filename: msg.filename });
        return { ok: true };
      } catch {
        return { ok: false }; // offscreen falls back to an in-document anchor download
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

async function captureFullPage(tabId: number): Promise<void> {
  const [res] = await browser.scripting.executeScript({
    target: { tabId },
    func: captureFullPageScript,
  });
  const dataUrl = res?.result as string | null;
  if (!dataUrl) throw new Error('Capture returned nothing');
  const filename = screenshotFilename('full').replace(/\.png$/, dataUrl.startsWith('data:image/jpeg') ? '.jpg' : '.png');
  await browser.downloads.download({ url: dataUrl, filename });
  const tab = await browser.tabs.get(tabId).catch(() => null);
  saveCaptureToLibrary({
    kind: 'screenshot',
    blob: dataUrlToBlob(dataUrl),
    pageUrl: tab?.url,
    pageTitle: tab?.title,
    filename,
  }).catch(() => {});
}

async function ensureOffscreenDocument(): Promise<void> {
  // getContexts (not an in-memory flag): survives service-worker restarts.
  const contexts = await (browser.runtime as any).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;
  await (browser as any).offscreen.createDocument({
    url: browser.runtime.getURL('/offscreen.html'),
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
    justification: 'Recording the screen/tab so the capture survives the popup closing',
  });
}

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
    streamId = await new Promise<string>((resolve, reject) => {
      browser.desktopCapture.chooseDesktopMedia(['screen', 'window', 'audio'] as any, tab as any, (id: string) => {
        if (id) resolve(id);
        else reject(new Error('Capture was cancelled'));
      });
    });
  }

  await browser.runtime.sendMessage({ target: 'ks-offscreen', type: 'OFFSCREEN_START', streamId, options });
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
// (It dies on browser restart; don't show a stuck REC state forever.)
async function verifiedRecordingState() {
  const state = await recordingStateStore.getValue();
  if (!state.isRecording) return state;
  const contexts = await (browser.runtime as any).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length === 0) {
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
  const dup = await findDuplicate(tab.url).catch(() => undefined);
  if (dup) {
    await flash('∃', '#6366f1');
    notify('Already saved', `You saved this ${agoLabel(dup.timestamps.createdAt)}. Open the dashboard to view it.`);
    return;
  }

  const meta = settings.enableMetadata ? await extractMeta(tab.id) : null;

  let screenshotBlob: Blob | undefined;
  if (settings.enableAutoScreenshot) {
    try {
      screenshotBlob = dataUrlToBlob(await captureVisibleTab());
    } catch {
      /* capture can fail on protected pages — save anyway */
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

  // Background AI pass — extract, embed locally, auto-file. Awaited so the
  // service worker stays alive, but the save above already succeeded.
  const result = await autofileSave(saved.id, { tabId: tab.id }).catch(() => null);
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

async function ensureContextMenu() {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: 'save-to-vault',
    title: 'Save page to Keepsake',
    contexts: ['page', 'link', 'selection'],
  });
}
