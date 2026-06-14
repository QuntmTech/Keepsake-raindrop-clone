import { defineConfig } from 'wxt';

// WXT reads this file to generate the MV3 manifest automatically.
// Entrypoints in /entrypoints get wired in for you — no manual manifest editing.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: 'Keepsake — bookmarks on steroids',
    description:
      'Save, tag, search, highlight, and preview pages — an AI-powered bookmark vault that goes far beyond raindrop.io.',
    version: '0.2.0',

    permissions: [
      'storage', // settings + local data + cached auth
      'unlimitedStorage', // local-first vault + preview screenshots without the 10MB cap
      'activeTab', // read the current tab's URL/title on demand
      'tabs', // capture screenshots + open dashboard tab
      'contextMenus', // right-click "Save to Keepsake"
      'sidePanel', // the side-panel UI surface
      'scripting', // inject metadata extractor + highlight logic
    ],

    // <all_urls>: content script (highlights) + captureVisibleTab + metadata extraction.
    // api.anthropic.com: optional AI features (auto-tag, summarize, ask-your-library).
    host_permissions: ['<all_urls>', 'https://api.anthropic.com/*'],

    side_panel: {
      default_path: 'sidepanel.html',
    },

    action: {
      default_title: 'Keepsake',
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
