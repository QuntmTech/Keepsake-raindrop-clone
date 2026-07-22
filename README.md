# Keepsake — bookmarks on steroids

An AI-powered bookmark vault and customizable new-tab Home for Chrome/Firefox (MV3). Save pages with tags and collections, search your full library, highlight text, capture screenshots, monitor saved pages, rewrite selected text, and ask questions grounded in what you saved.

> **Local-first.** Keepsake works out of the box with on-device storage. A PocketBase backend is available behind the same interface for cross-device sync and hosted accounts.

## Stack

- **WXT** — MV3 framework with file-based entrypoints and cross-browser builds
- **React 19 + TypeScript + Tailwind 3** — light/dark themes and runtime accent colors
- **Pluggable backend** — local `chrome.storage` by default, PocketBase optional
- **Provider-agnostic BYOK AI** — Anthropic, OpenAI, or Google
- **Local embeddings** — Transformers.js in an offscreen document for semantic matching

---

## Quick start

```bash
npm install
npm run dev
```

Create an account in the extension and start saving. Local mode needs no server.

### Validation and production builds

```bash
npm test              # retrieval + bulk + UI + Quick Bar + AI Writer regression tests
npm run compile       # TypeScript check
npm run build         # .output/chrome-mv3
npm run check         # version + tests + type-check + build
npm run zip:store     # Chrome Web Store ZIP with development key removed
```

### Loading it into Chrome

1. Run `npm run build`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `.output/chrome-mv3`, the folder containing `manifest.json`.

Use `npm run zip:store` for a Web Store upload. Do not upload the normal development ZIP because local development uses a fixed manifest key to preserve the extension ID.

### Turning on AI

Ask Your Library and dashboard Smart Search both work without an API key by returning the strongest local matches. AI Writer, synthesized answers, smarter reranking, and automated filing use the configured provider. Open Settings → **AI**, enable AI, select a provider, paste its API key, and click **Test key**.

Default model tiers:

| Provider | Fast tasks | Ask your library |
|---|---|---|
| Anthropic | `claude-haiku-4-5` | `claude-opus-4-8` |
| OpenAI | `gpt-4o-mini` | `gpt-4o` |
| Google | `gemini-2.5-flash` | `gemini-2.5-pro` |

The key is stored in `chrome.storage.local`, never synced, and only sent to the provider the user selected. Selected/page text is treated as untrusted data, and Ask Your Library retrieves a small relevant source set before calling the provider.

### Switching to PocketBase

1. Copy `.env.example` to `.env` and configure the PocketBase URL when building a custom deployment.
2. Create/import the required collections described in `pocketbase/schema.md` and `docs/POCKETBASE_BUILD_PROMPT.md`.
3. In a non-hosted build, open Settings → **Storage** → **PocketBase server** and connect it.

---

## Features

- **Home launcher** — pinned app tiles, folders, drag-and-drop ordering, wallpapers, and optional dashboard widgets
- **Quick Bar** — a self-healing in-page command dock that drags vertically, snaps to either browser edge, collapses to a visible tab, opens AI Writer, browses collections, and reports failures instead of pretending success
- **AI Writer** — load selected page or editable-field text, improve grammar, rewrite, shorten, expand, simplify, change tone, run custom instructions, copy, safely replace, undo, and attach results to a saved page
- **Context-aware saving** — opening Save while browsing a collection preselects that collection; opening it from Unsorted preselects no collection
- **Capture Studio** — visible/full-page screenshots, recordings, clipboard, and downloads
- **AI filing** — optional summaries, tags, confidence-based filing, and an Inbox fallback
- **Ask Your Library** — hybrid full-library retrieval, source snippets, numbered citations, follow-up context, and local fallback matches
- **Ambient Recall** — surfaces related saved pages while browsing, with local matching and a domain blocklist
- **Living Bookmarks** — content, price, and availability watches with notifications
- **Bulk library control** — select visible or individual saves, then move, tag, favorite, delete, or retry AI filing in bounded batches
- **Organize** — collections, nested folders, tags, favorites, smart filters, Inbox review, and duplicate cleanup
- **Find** — instant text search, keyless Smart Search with optional AI reranking, command palette, multiple sorts, and grid/list/masonry views
- **Highlights** — quote-and-context anchored annotations that survive many page changes
- **Portable** — imports from browser HTML, Raindrop, Pocket, and Keepsake JSON; exports JSON backups
- **Resilient** — offline save queue, PocketBase request retries, cached startup data, durable Quick Bar state, and Home-field fallback storage

The Quick Bar and selected-text tools cannot run on Chrome-owned pages such as `chrome://extensions`, the Chrome Web Store, or some built-in new-tab pages because Chrome blocks content scripts there.

---

## Project map

```text
entrypoints/
  background.ts     service worker, capture, queues, watches, commands, billing handoff
  content.ts        self-healing Quick Bar, safe selected-text replacement, and highlights
  newtab/           Home launcher and widgets
  popup/            collection-aware quick save and compact library/settings surfaces
  sidepanel/        docked Save / Library / AI Workbench surfaces
  dashboard/        complete bookmark library, bulk cleanup, and smart search
  options/          account, AI, capture, appearance, import/export, billing
components/
  AIWriter.tsx       rewrite/grammar/tone UI with copy, replace, undo, and save
  AIWorkbench.tsx    compact Write / Ask Library switcher
  BulkActionBar.tsx  bounded multi-bookmark cleanup controls
  home/              Home widgets and customization controls
lib/
  backend/           local and PocketBase implementations behind one interface
  ai.ts              tags, summaries, hybrid retrieval, and grounded library Q&A
  aiWriter.ts        provider execution and session-persisted writer drafts
  aiWriterPrompt.ts  pure prompt construction, normalization, and change summaries
  bulk.ts            pure selection, tag normalization, and bounded batch helpers
  llm.ts             Anthropic/OpenAI/Google adapters and provider safety
  retrieval.ts       deterministic ranking and evidence-snippet selection
  uiContext.ts       save-context resolution and Quick Bar positioning helpers
  quickbar.ts        customizable edge-snapping in-page command dock
  embedder.ts        local semantic embeddings
  home.ts            durable Home pin/order overlay
  widgets.ts         Home widget data and browser integrations
  wallpaper.ts       safe and optimized Home backgrounds
  watch.ts           Living Bookmarks scheduler and comparison logic
pocketbase/          schema and server-side setup material
scripts/             release and regression tests
```

---

## Backend abstraction

The UI calls `lib/bookmarks`, `lib/highlights`, and `lib/auth`. Those facades delegate to the active backend from `lib/backend/index.ts`. Both local and PocketBase storage implement the same `Backend` interface, so UI components do not contain database-specific logic.

## Security notes

- AI keys remain in local extension storage and are never committed or synced.
- AI requests have hard timeouts and provider-specific error handling.
- Selected/page text is isolated as untrusted source material in AI Writer prompts.
- AI replacement validates that the captured selection is still current and requires an explicit click; it never silently overwrites typed text.
- Quick Bar collection labels are rendered as text, not injected HTML.
- Bulk operations use bounded batches instead of flooding storage or the background worker.
- PocketBase rules must enforce per-user access with `user = @request.auth.id`.
- Local-mode passwords are salted and hashed for on-device profile separation; use PocketBase for real hosted authentication.
- `<all_urls>` is required for user-triggered capture, metadata, highlights, AI selection tools, and in-page features.
- Anthropic, OpenAI, and Google API hosts are used only when the user enables BYOK AI.
- Weather hosts and full-page MHTML capture remain optional permissions.
