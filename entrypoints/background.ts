import { loadAuth } from '@/lib/pocketbase';
import { getSettings, watchSettings } from '@/lib/settings';
import { saveBookmark } from '@/lib/bookmarks';
import { type Message, type ScreenshotResult, dataUrlToBlob } from '@/lib/messaging';
import { type UiSurface } from '@/lib/types';

// The background "service worker" is event-driven and can be killed at any time by Chrome.
// Never rely on long-lived in-memory state here — read from storage when you need it.

export default defineBackground(() => {
  // ---- startup ----
  browser.runtime.onInstalled.addListener(async () => {
    await ensureContextMenu();
    const settings = await getSettings();
    await applyActionBehavior(settings.primarySurface);
  });

  browser.runtime.onStartup?.addListener(async () => {
    const settings = await getSettings();
    await applyActionBehavior(settings.primarySurface);
  });

  // Re-apply icon behavior whenever the user changes the primary surface in Options.
  watchSettings((s) => {
    applyActionBehavior(s.primarySurface);
  });

  // ---- toolbar icon click (only fires when no popup is set) ----
  browser.action.onClicked.addListener(async (tab) => {
    const { primarySurface } = await getSettings();
    if (primarySurface === 'sidepanel') {
      // @ts-expect-error - sidePanel types vary by @types/chrome version
      await browser.sidePanel.open({ tabId: tab.id });
    } else if (primarySurface === 'dashboard') {
      await openDashboard();
    }
    // 'popup' case never reaches here — the popup opens natively.
  });

  // ---- right-click context menu ----
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'save-to-vault' && tab) {
      await saveTab(tab);
    }
  });

  // ---- message hub ----
  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    handleMessage(msg).then(sendResponse);
    return true; // keep the channel open for the async response
  });
});

async function handleMessage(msg: Message): Promise<unknown> {
  await loadAuth();
  switch (msg.type) {
    case 'PING':
      return { ok: true };

    case 'CAPTURE_SCREENSHOT': {
      const dataUrl = await captureVisibleTab();
      return { dataUrl } satisfies ScreenshotResult;
    }

    case 'SAVE_CURRENT_PAGE': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) await saveTab(tab, msg.collection);
      return { ok: true };
    }

    case 'OPEN_DASHBOARD':
      await openDashboard();
      return { ok: true };

    default:
      return { ok: false, error: 'unknown message' };
  }
}

// Capture the visible area of the active tab as a JPEG dataURL.
// NOTE for Claude Code: this is visible-viewport only. Full-page stitched capture needs
// either chrome.debugger (CDP Page.captureScreenshot) or a scroll-and-stitch routine. TODO.
async function captureVisibleTab(): Promise<string> {
  return browser.tabs.captureVisibleTab(undefined as any, { format: 'jpeg', quality: 70 });
}

async function saveTab(tab: chrome.tabs.Tab, collection?: string) {
  if (!tab.url) return;
  await loadAuth();

  const settings = await getSettings();
  let screenshotBlob: Blob | undefined;

  if (settings.enableAutoScreenshot) {
    try {
      const dataUrl = await captureVisibleTab();
      screenshotBlob = dataUrlToBlob(dataUrl);
    } catch {
      // capture can fail on chrome:// pages or if the tab isn't focused — save anyway.
    }
  }

  await saveBookmark({
    url: tab.url,
    title: tab.title ?? tab.url,
    collection: collection ?? settings.defaultCollection,
    screenshotBlob,
  });

  // Lightweight confirmation toast via badge.
  await browser.action.setBadgeText({ text: '✓' });
  setTimeout(() => browser.action.setBadgeText({ text: '' }), 1500);
}

async function openDashboard() {
  const url = browser.runtime.getURL('/dashboard.html');
  await browser.tabs.create({ url });
}

// The key trick for a configurable primary surface in MV3:
// setting a popup makes clicks open the popup; clearing it makes onClicked fire instead.
async function applyActionBehavior(surface: UiSurface) {
  if (surface === 'popup') {
    await browser.action.setPopup({ popup: 'popup.html' });
  } else {
    await browser.action.setPopup({ popup: '' }); // empty => onClicked fires
  }

  // Side panel: only auto-open on click when chosen; otherwise leave it manual.
  try {
    // @ts-expect-error - setPanelBehavior exists at runtime (Chrome 114+)
    await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    /* not available in this browser */
  }
}

async function ensureContextMenu() {
  await browser.contextMenus.removeAll();
  browser.contextMenus.create({
    id: 'save-to-vault',
    title: 'Save page to vault',
    contexts: ['page', 'link', 'selection'],
  });
}
