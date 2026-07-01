import { defineConfig } from 'wxt';

// WXT reads this file to generate the MV3 manifest automatically.
// Entrypoints in /entrypoints get wired in for you — no manual manifest editing.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: 'Keepsake — bookmarks on steroids',
    description:
      'Save, tag, search, highlight, and preview pages — an AI-powered bookmark vault that goes far beyond raindrop.io.',
    version: '8.0.0',

    // Pins a stable extension ID across reloads / loading from a new folder, so
    // your locally-stored bookmarks survive updates instead of being wiped.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAiSj7RxnE0Qci0KQwiKiKKFhF4azzvI7v4csqTBHOWfd2leb091Rg7RDmPvJYyrP+crea+9kF65FJX269IM6ri6t2WGCQNfEOGDRiK+yH6USePTViESCcm7jrhjlVMUl3uKu4+TJEpD/D1HL8NDtmQ9m4NUmqdCG+YDpo2DRx6GqjMgIZwVTbNAwm4Lz+h0vsJNa5EiLFIeMuHDkNN4m6//LmApl11EBOlWP7LoX5nyeTB+pnOt/zH2g3kdpSfLWv83UjIYVe5K5xPKpgMmDWULFDbn+ZvvVfQK0/fDoHe3opO1Jx1dyqKUqZtFhObS+aMFvztJUlrJyQJdFrCcmVtQIDAQAB',

    permissions: [
      'storage', // settings + local data + cached auth
      'unlimitedStorage', // local-first vault + preview screenshots without the 10MB cap
      'activeTab', // read the current tab's URL/title on demand
      'tabs', // capture screenshots + open dashboard tab
      'contextMenus', // right-click "Save to Keepsake"
      'sidePanel', // the side-panel UI surface
      'scripting', // inject metadata extractor + highlight logic
      'downloads', // save screenshots + recordings to Downloads/Keepsake
      'offscreen', // MV3 recorder document (recording survives popup close)
      'tabCapture', // "record this tab" stream ids
      'desktopCapture', // screen/window picker for recording
      'notifications', // surface async capture failures after the popup closed
    ],

    // <all_urls>: content script (highlights) + captureVisibleTab + metadata extraction.
    // api.anthropic.com: optional AI features (auto-tag, summarize, ask-your-library).
    host_permissions: ['<all_urls>', 'https://api.anthropic.com/*'],

    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },

    side_panel: {
      default_path: 'sidepanel.html',
    },

    action: {
      default_title: 'Keepsake',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },

    // Keyboard shortcuts. Chrome lets users remap these at chrome://extensions/shortcuts.
    commands: {
      'save-page': {
        suggested_key: { default: 'Ctrl+Shift+S' },
        description: 'Save the current page to Keepsake',
      },
      'open-dashboard': {
        suggested_key: { default: 'Ctrl+Shift+E' },
        description: 'Open the Keepsake dashboard',
      },
      'quick-save': {
        suggested_key: { default: 'Ctrl+Shift+K' },
        description: 'Quick-save with a folder picker (pops out on the page)',
      },
    },
  },
});
