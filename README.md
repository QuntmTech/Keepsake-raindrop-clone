# Raindrop Clone — MV3 bookmark manager (WXT + React + PocketBase)

A raindrop.io-style bookmark vault as a Chrome extension. Save pages with tags + collections,
full-text search, on-page highlights, and auto preview screenshots. Three UI surfaces
(popup, side panel, full dashboard) — switchable in Settings.

## Stack
- **WXT** — MV3 framework, file-based entrypoints, cross-browser
- **React 19 + TypeScript + Tailwind 3**
- **PocketBase** — self-hosted backend (DB + auth + file storage)

---

## Quick start

```bash
# 1. install deps
npm install

# 2. point at your PocketBase server
cp .env.example .env
#    edit .env -> WXT_PB_URL=https://your-pocketbase-url

# 3. create the collections in PocketBase admin (see pocketbase/schema.md)

# 4. run in dev (loads with hot reload)
npm run dev
```

`npm run dev` opens a Chrome instance with the extension loaded. Or build and load manually:

```bash
npm run build
# then chrome://extensions -> Developer mode -> Load unpacked -> .output/chrome-mv3
```

---

## Project map

```
entrypoints/
  background.ts     # service worker: context menu, screenshot capture,
                    #   and the settings-driven "what opens on icon click" logic
  content.ts        # on-page highlight toolbar + re-apply saved highlights
  popup/            # fast-save UI
  sidepanel/        # docked library + save
  dashboard/        # full-page library (own tab)
  options/          # settings: pick primary surface + toggle features
lib/
  pocketbase.ts     # PB client + auth, mirrored into chrome.storage so all contexts share login
  bookmarks.ts      # save / update / delete / search / collections
  highlights.ts     # highlight CRUD
  settings.ts       # settings persisted to chrome.storage.sync
  messaging.ts      # typed message contract between contexts + dataURL->Blob helper
  types.ts          # shared models
components/         # LoginForm, SaveForm, BookmarkCard, BookmarkGrid
hooks/              # useAuth, useSettings
pocketbase/schema.md  # collections to create
```

---

## TODO list for Claude Code (fine-tune from here)

These are intentionally left as the next layer of work:

1. **Robust highlight anchoring.** `content.ts` uses naive first-text-match re-application.
   Swap in a real anchoring approach (W3C TextQuoteSelector via `apache-annotator`, or `rangy`)
   so highlights survive DOM changes and multi-node selections. Persist the anchor to the
   `highlights.anchor` field already wired in `types.ts` + `highlights.ts`.
2. **Full-page screenshots.** Background captures the visible viewport only
   (`chrome.tabs.captureVisibleTab`). Add scroll-and-stitch or `chrome.debugger`
   (CDP `Page.captureScreenshot` with `captureBeyondViewport`) for full-page previews.
3. **Collections UI.** CRUD exists in `lib/bookmarks.ts`; build the sidebar tree
   (create/rename/nest/drag) in dashboard + sidepanel.
4. **Tag autocomplete** in `SaveForm` (suggest from existing tags).
5. **Metadata enrichment** on save — fetch og:image / favicon for `cover` when no screenshot.
6. **Signup flow** (currently login only). PocketBase `users.create` + email verification.
7. **Dark mode wiring** — `settings.theme` is stored but not yet applied; toggle the `dark`
   class on `<html>` per setting (Tailwind `darkMode: 'class'` is already configured).
8. **Offline queue** — if a save fails (offline), queue in chrome.storage and retry.
9. **Import** from browser bookmarks or a raindrop.io export.
10. **Firefox build** — `npm run dev:firefox`; verify side panel (`sidebar_action`) maps over.

---

## Security notes (already in place / to keep)
- No secrets in code — backend URL via `WXT_PB_URL` env only.
- PocketBase API rules enforce per-user row access (see `pocketbase/schema.md`); never trust
  the client alone — the `user = @request.auth.id` rule is the real guard.
- Keep `host_permissions` as tight as the feature set allows for Web Store review.
