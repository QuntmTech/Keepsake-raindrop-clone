# Keepsake — bookmarks on steroids

An AI-powered bookmark vault as a Chrome/Firefox extension (MV3). Save pages with tags +
collections, full-text search, on-page highlights, auto previews — plus AI auto-tagging,
summaries, and an **“ask your library”** assistant that answers questions across everything
you’ve saved. Four UI surfaces (popup, side panel, full dashboard, settings).

> **Local-first.** Keepsake works fully **out of the box with zero setup** — accounts,
> bookmarks, collections, highlights, and search all run on-device via `chrome.storage`.
> A PocketBase backend is available behind the same interface for cross-device sync when
> you’re ready (Settings → Storage).

## Stack
- **WXT** — MV3 framework, file-based entrypoints, cross-browser
- **React 19 + TypeScript + Tailwind 3** with a runtime-themeable design system (light/dark + 6 accents)
- **Pluggable backend** — `local` (chrome.storage) by default, `pocketbase` optional
- **Anthropic API** (optional, bring-your-own-key) for AI features

---

## Quick start

```bash
npm install
npm run dev          # opens Chrome with the extension loaded (hot reload)
```

That’s it — create an account in the popup and start saving. No server required.

Build a loadable bundle:

```bash
npm run build        # output in .output/chrome-mv3
# chrome://extensions → Developer mode → Load unpacked → .output/chrome-mv3
npm run compile      # type-check only
```

### Turning on AI (optional)
Settings → **AI** → enable, paste an Anthropic API key (`console.anthropic.com`), Test key.
- Auto-tagging + summaries use `claude-haiku-4-5` (fast + cheap)
- “Ask your library” uses `claude-opus-4-8`

The key is stored in `chrome.storage.local` on your device and is only ever sent to the
Anthropic API (via the official direct-browser-access header). It is never synced or committed.

### Switching to PocketBase (optional, later)
1. `cp .env.example .env` and set `WXT_PB_URL=https://your-pocketbase-url`
2. Create the collections in PocketBase admin (see `pocketbase/schema.md`)
3. Settings → **Storage** → “PocketBase server”

---

## Features
- **Capture** — popup quick-save, right-click menu, `Ctrl+Shift+S` shortcut; auto screenshot,
  og:image cover, favicon, reading-time, and content-type detection.
- **AI** — auto-suggested tags, one-line summaries, and a chat assistant grounded in your vault.
- **Organize** — nestable collections with colors, tag autocomplete, favorites, smart filters
  (All / Favorites / Untagged / by collection / by tag).
- **Find** — `⌘K`/`Ctrl+K` command palette (search + actions), live filtering, multiple sorts,
  three layouts (grid / list / masonry).
- **Highlights** — select text on any page to highlight it; robust quote+context anchoring
  re-applies highlights across DOM changes and multi-node selections.
- **Reliable** — offline save queue retries on reconnect; nothing typed is lost.
- **Portable** — import browser / raindrop.io bookmark HTML or Keepsake JSON; export JSON.
- **Polished** — real dark mode, six accent themes, toasts, skeletons, keyboard-first.

---

## Project map
```
entrypoints/
  background.ts   # service worker: context menu, screenshots, metadata injection,
                  #   AI-enriched save, queue flush, keyboard commands, icon behavior
  content.ts      # on-page highlight toolbar + quote-based re-anchoring
  popup/          # fast-save UI + recent saves
  sidepanel/      # docked Save / Library / Ask tabs
  dashboard/      # full library: sidebar, command palette, AI panel, add/edit
  options/        # settings: account, storage, surface, AI, capture, theme, import/export
lib/
  backend/        # Backend interface + local (chrome.storage) and pocketbase implementations
  auth.ts         # backend-agnostic auth facade
  bookmarks.ts    # bookmark + collection facade over the active backend
  highlights.ts   # highlight facade
  ai.ts           # Anthropic Messages API: tags, summaries, ask-your-library
  metadata.ts     # injected page-metadata extractor (og:image, favicon, reading time)
  queue.ts        # offline save queue
  importer.ts     # import/export (Netscape HTML + Keepsake JSON)
  theme.ts        # theme + accent application
  settings.ts     # settings persisted to chrome.storage.sync
  util.ts         # pure helpers (domain, favicon, type inference, sorting)
  types.ts        # shared models
components/        # design-system UI (cards, sidebar, palette, dialogs, AI panel, …)
hooks/             # useAuth, useSettings, useTheme, useCollections
pocketbase/schema.md  # collections to create when using the PocketBase backend
```

---

## How the backend abstraction works
The UI never talks to a database directly — it calls `lib/bookmarks`, `lib/highlights`, and
`lib/auth`, which delegate to whichever backend is active (`lib/backend/index.ts`). Both the
local and PocketBase backends implement the same `Backend` interface (`lib/backend/types.ts`),
so switching is a single setting and adding a new backend is a single new file.

---

## Security notes
- No secrets in code — PocketBase URL via `WXT_PB_URL`; AI key in `chrome.storage.local` only.
- PocketBase API rules enforce per-user row access (`user = @request.auth.id`).
- The local backend scopes every record to the signed-in account and hashes passwords
  (SHA-256 + per-user salt) — fine for on-device use; use PocketBase for real multi-user auth.
- `host_permissions`: `<all_urls>` (highlights, screenshots, metadata) and
  `https://api.anthropic.com/*` (only used when AI is enabled).
