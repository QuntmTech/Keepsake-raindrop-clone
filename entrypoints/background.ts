import { getBackend } from '@/lib/backend';
import { getSettings, watchSettings } from '@/lib/settings';
import { saveBookmark } from '@/lib/bookmarks';
import { enqueueSave, flushQueue } from '@/lib/queue';
import { aiAvailable, getAiSettings, suggestTags, summarize, type PageContext } from '@/lib/ai';
import { type Message, type ScreenshotResult, type MetaResult, dataUrlToBlob } from '@/lib/messaging';
import { extractPageMeta, type PageMeta } from '@/lib/metadata';
import { inferType, safeDomain } from '@/lib/util';
import { type UiSurface } from '@/lib/types';

// The background "service worker" is event-driven and can be killed at any time by Chrome.
// Never rely on long-lived in-memory state here — read from storage when you need it.

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    await ensureContextMenu();
    const settings = await getSettings();
    await applyActionBehavior(settings.primarySurface);
    await flushQueue().catch(() => {});
  });

  browser.runtime.onStartup?.addListener(async () => {
    const settings = await getSettings();
    await applyActionBehavior(settings.primarySurface);
    await flushQueue().catch(() => {});
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

    default:
      return { ok: false, error: 'unknown message' };
  }
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

// Full save pipeline used by the context menu + keyboard shortcut.
async function saveTab(tab: chrome.tabs.Tab, collection?: string) {
  if (!tab.url) return;
  await getBackend();
  const settings = await getSettings();

  const meta = settings.enableMetadata ? await extractMeta(tab.id) : null;

  let screenshotBlob: Blob | undefined;
  if (settings.enableAutoScreenshot) {
    try {
      screenshotBlob = dataUrlToBlob(await captureVisibleTab());
    } catch {
      /* capture can fail on protected pages — save anyway */
    }
  }

  let tags: string[] = [];
  let aiTags: string[] = [];
  let summary: string | undefined;
  if (await aiAvailable()) {
    const ai = await getAiSettings();
    const ctx: PageContext = {
      title: meta?.title || tab.title || tab.url,
      url: tab.url,
      description: meta?.description,
      text: meta?.text,
    };
    if (ai.autoTag) {
      aiTags = await suggestTags(ctx).catch(() => []);
      tags = aiTags;
    }
    if (ai.autoSummarize) summary = await summarize(ctx).catch(() => undefined);
  }

  const input = {
    url: tab.url,
    title: meta?.title || tab.title || tab.url,
    description: meta?.description,
    summary,
    content: meta?.text,
    tags,
    aiTags,
    collection: collection ?? settings.defaultCollection,
    cover: meta?.cover,
    favicon: meta?.favicon,
    domain: safeDomain(tab.url),
    type: meta?.type ?? inferType(tab.url),
    readingTime: meta?.readingTime,
    screenshotBlob,
  };

  try {
    await saveBookmark(input);
    await flash('✓', '#16a34a');
  } catch {
    await enqueueSave(input);
    await flash('…', '#f59e0b'); // queued offline
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
