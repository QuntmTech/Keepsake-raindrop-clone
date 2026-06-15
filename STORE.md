# Chrome Web Store listing kit

Copy/paste for the Web Store submission. Replace bracketed placeholders.

## Name
Keepsake — Bookmarks on Steroids

## Short description (≤132 chars)
Save, tag, search, and highlight pages in a beautiful vault — with AI auto-tagging,
summaries, and ask-your-library search. Cloud-synced.

## Category
Productivity

## Detailed description
Keepsake is a next-generation bookmark manager that goes far beyond the built-in
browser bookmarks (and beyond raindrop.io).

• One-click save — toolbar popup, right-click menu, keyboard shortcut, or the
  draggable in-page Quick Bar. Auto-captures the cover image, favicon, and reading time.
• Organize — colored collections, tag autocomplete, favorites, and smart filters.
  Drag bookmarks straight into folders.
• Find instantly — ⌘K / Ctrl-K command palette, live search, and grid / list /
  masonry views.
• Highlight the web — select text on any page to highlight it; highlights reappear
  when you return.
• AI superpowers (optional, bring your own key) — auto-suggest tags, one-line
  summaries, and "ask your library" to find anything in plain English.
• Yours everywhere — real accounts with cloud sync; your vault survives reinstalls
  and follows you across devices.
• Polished — true dark mode, six accent themes, fast and keyboard-friendly.

Sign up, start saving, done.

## Single purpose (required field)
Keepsake lets users save, organize, search, and annotate web pages as bookmarks,
synced to their account.

## Permission justifications (paste in the dashboard)
- storage / unlimitedStorage: store user settings and cache bookmarks/screenshots.
- activeTab, tabs: read the current tab's URL/title and capture a preview screenshot
  when the user saves a page; open the dashboard tab.
- scripting: extract page metadata and run on-page highlighting on pages the user acts on.
- contextMenus: provide the right-click "Save to Keepsake" action.
- sidePanel: provide the optional side-panel UI.
- host permission `<all_urls>`: required so "save this page" and highlighting work on
  any website the user visits. Page content is only read when the user explicitly saves
  or highlights that page.
- host permission `https://api.anthropic.com/*`: only used when the user enables optional
  AI features with their own API key.

## Privacy policy URL
[https://yourdomain.com/keepsake-privacy]  (host the contents of PRIVACY.md)

## Assets needed (you provide)
- Store icon: 128×128 (already in the build: public/icon/128.png).
- At least 1 screenshot, 1280×800 or 640×400 (popup + dashboard recommended).
- Optional: small promo tile 440×280.

## Before uploading
- Remove the dev `key` from wxt.config.ts manifest (let the Store assign the ID),
  OR keep it if you want a fixed ID — but the Store-assigned key is recommended for
  a first public listing.
- Bump version as needed and run `npm run zip` → upload `.output/keepsake-*-chrome.zip`.
