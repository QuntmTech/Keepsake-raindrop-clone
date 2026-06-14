import { defineConfig } from 'wxt';

// WXT reads this file to generate the MV3 manifest automatically.
// Entrypoints in /entrypoints get wired in for you — no manual manifest editing.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],

  manifest: {
    name: 'Raindrop Clone',
    description: 'Save, tag, search, highlight, and preview pages — your own bookmark vault.',
    version: '0.1.0',

    // Permissions: keep this list tight. Each one is a Web Store review flag.
    permissions: [
      'storage',        // settings + cached auth
      'activeTab',      // read the current tab's URL/title on demand
      'tabs',           // needed to capture screenshots + open dashboard tab
      'contextMenus',   // right-click "Save to vault"
      'sidePanel',      // the side-panel UI surface
      'scripting',      // inject highlight logic when needed
    ],

    // <all_urls> is required for the content script (highlights on any page) and
    // for captureVisibleTab screenshots. Reviewers will ask why — answer: highlights + preview.
    host_permissions: ['<all_urls>'],

    // Side panel default page (Chrome 114+).
    side_panel: {
      default_path: 'sidepanel.html',
    },

    // NOTE: we intentionally DO NOT set action.default_popup here.
    // The background worker sets/clears the popup at runtime based on the user's
    // chosen UI surface (popup vs side panel vs dashboard). See entrypoints/background.ts.
    action: {
      default_title: 'Raindrop Clone',
    },
  },

  // Build output goes to .output/chrome-mv3 — load THAT folder as unpacked.
});
