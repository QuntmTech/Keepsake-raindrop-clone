# Keepsake — Privacy Policy

_Last updated: 2026-06-15_

Keepsake is a bookmark manager browser extension. This policy explains what data
it handles and why. **You must host this policy at a public URL and put that URL
in the Chrome Web Store listing.**

## What we store
When you create an account and use Keepsake, the following is stored on Keepsake's
backend server (a self-hosted PocketBase instance) so it can sync across your devices:
- **Account:** your email address and a securely hashed password.
- **Your saved content:** bookmarks (URL, title, description, your notes/summary,
  tags), collections (folders), highlights you make on pages, and — if you enable
  it — preview screenshots of pages you save.

We do **not** collect browsing history, and the extension only reads a page's URL,
title, and content **when you choose to save or highlight that page.**

## Permissions, and why each is needed
- **storage / unlimitedStorage** — save your settings and cache your data.
- **activeTab / tabs** — read the current tab's URL & title when you save it, and
  capture an optional preview screenshot.
- **scripting** — read page metadata (title, description, cover image, reading time)
  and power on-page highlighting, only on pages you act on.
- **contextMenus** — the right-click "Save to Keepsake" item.
- **sidePanel** — the optional side-panel interface.
- **host access (`<all_urls>`)** — required so highlighting and "save this page"
  work on any site you visit. We never read or transmit page contents unless you
  explicitly save or highlight that page.
- **api.anthropic.com** — only used if you turn on optional AI features (see below).

## Optional AI features
AI features (auto-tagging, summaries, "ask your library") are **off by default**.
If you enable them, you provide **your own Anthropic API key**, which is stored
locally on your device and never sent to us. When AI is on, the title, URL, and a
text excerpt of a page you save (or your question + your bookmark list) are sent to
Anthropic's API to generate the result. See Anthropic's privacy policy for their
handling. Turn AI off to stop all such requests.

## What we do NOT do
- We do not sell or share your personal data.
- We do not run third-party advertising or tracking/analytics.

## Data retention & deletion
Your data persists until you delete it. You can delete individual items, or request
full account/data deletion by contacting us.

## Contact
**[your-email@yourdomain.com]** — replace with your real support email before publishing.
