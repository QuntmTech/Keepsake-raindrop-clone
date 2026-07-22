from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


root = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# Background: authoritative dedupe, explicit Unsorted, safe refresh, instant
# acknowledgement, durable AI queue, and on-demand local Ambient Recall.
# ---------------------------------------------------------------------------
background_path = root / 'entrypoints/background.ts'
background = background_path.read_text()
background = replace_once(
    background,
    "import { saveBookmark } from '@/lib/bookmarks';",
    "import { findByUrl, saveBookmark } from '@/lib/bookmarks';",
    'background bookmark import',
)
background = replace_once(
    background,
    "import { agoLabel, autofileSave, findDuplicate, undoFiling, type FiledResult } from '@/lib/autofile';",
    "import { agoLabel, autofileSave, undoFiling, type FiledResult } from '@/lib/autofile';",
    'remove sidecar-only duplicate import',
)
background = replace_once(
    background,
    "import { processQueueTick, scheduleQueue, QUEUE_ALARM } from '@/lib/aiQueue';",
    "import { processQueueTick, scheduleQueue, scheduleQueueSoon, QUEUE_ALARM } from '@/lib/aiQueue';",
    'background queue import',
)
background = replace_once(
    background,
    "import { normalizeQuickBarUrl } from '@/lib/quickbarConfig';",
    "import { normalizeQuickBarUrl, resolveSaveCollection, sameCanonicalUrl } from '@/lib/quickbarConfig';",
    'background quickbar helpers',
)
background = replace_once(
    background,
    "      return saveTab(tab, msg.collection, Boolean(msg.force));",
    "      return saveTab(tab, msg.collection, Boolean(msg.force), Boolean(msg.explicitCollection));",
    'background save intent',
)
old_refresh = """    case 'REFRESH_BOOKMARK': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return { ok: false, error: 'No active page to refresh from.' };
      const meta = await extractMeta(tab.id);
      const bookmark = await updateBookmark(msg.id, {
        url: tab.url,
        title: meta?.title || tab.title || tab.url,
        description: meta?.description,
        content: meta?.text,
        cover: meta?.cover,
        favicon: meta?.favicon,
        domain: safeDomain(tab.url),
        type: meta?.type ?? inferType(tab.url),
        readingTime: meta?.readingTime,
      });
      return { ok: true, bookmark };
    }"""
new_refresh = """    case 'REFRESH_BOOKMARK': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return { ok: false, error: 'No active page to refresh from.' };
      if (!sameCanonicalUrl(tab.url, msg.url)) {
        return { ok: false, error: 'The page changed before refresh. Open the saved page and try again.' };
      }
      const existing = await findByUrl(msg.url).catch(() => null);
      if (!existing || existing.id !== msg.id) {
        return { ok: false, error: 'That saved item no longer matches this page.' };
      }
      const meta = await extractMeta(tab.id);
      const patch: Parameters<typeof updateBookmark>[1] = {
        url: tab.url,
        title: meta?.title || tab.title || tab.url,
        domain: safeDomain(tab.url),
        type: meta?.type ?? inferType(tab.url),
      };
      if (meta?.description !== undefined) patch.description = meta.description;
      if (meta?.text !== undefined) patch.content = meta.text;
      if (meta?.cover !== undefined) patch.cover = meta.cover;
      if (meta?.favicon !== undefined) patch.favicon = meta.favicon;
      if (meta?.readingTime !== undefined) patch.readingTime = meta.readingTime;
      const bookmark = await updateBookmark(msg.id, patch);
      return { ok: true, bookmark };
    }"""
background = replace_once(background, old_refresh, new_refresh, 'safe refresh handler')
old_recall = """    case 'KS_GET_RECALL': {
      let tabId = msg.tabId;
      if (tabId == null) {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      const cache = await recallCache.getValue();
      return { ok: true, result: tabId != null ? cache[tabId] ?? null : null };
    }"""
new_recall = """    case 'KS_GET_RECALL': {
      let tabId = msg.tabId;
      if (tabId == null) {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      let cache = await recallCache.getValue();
      let result = tabId != null ? cache[tabId] ?? null : null;
      // The Quick Bar loads at document_idle and can beat webNavigation's cache
      // write. Compute once on demand, still entirely locally and only when the
      // user's Ambient Recall setting/blocklist allows this page.
      if (!result && tabId != null) {
        const tab = await browser.tabs.get(tabId).catch(() => null);
        if (tab?.url && (await recallAllowed(tab.url))) {
          await runRecall(tabId, tab.url).catch(() => {});
          cache = await recallCache.getValue();
          result = cache[tabId] ?? null;
        }
      }
      return { ok: true, result };
    }"""
background = replace_once(background, old_recall, new_recall, 'on-demand recall cache')
background = replace_once(
    background,
    "  collection?: string,\n  force = false,\n): Promise<SaveCurrentPageResult> {",
    "  collection?: string,\n  force = false,\n  explicitCollection = false,\n): Promise<SaveCurrentPageResult> {",
    'saveTab signature',
)
old_dedupe = """  if (!force) {
    const dup = await findDuplicate(tab.url).catch(() => undefined);
    if (dup) {
      if (collection !== undefined) {
        await updateBookmark(dup.id, { collection: collection || '' }).catch(() => {});
        await flash('✓', '#16a34a');
      } else {
        await flash('∃', '#6366f1');
      }
      return {
        ok: true,
        status: 'duplicate',
        id: dup.id,
        title: dup.title,
        collection: collection !== undefined ? collection : dup.organization.collectionId,
      };
    }
  }"""
new_dedupe = """  if (!force) {
    // Use the authoritative active backend, not only the AI sidecar. This catches
    // old local rows, imported data, and cloud saves even before sidecar repair.
    const dup = await findByUrl(tab.url).catch(() => null);
    if (dup) {
      if (explicitCollection) {
        const destination = collection || '';
        await updateBookmark(dup.id, { collection: destination }).catch(() => {});
        await flash('✓', '#16a34a');
        dup.collection = destination;
      } else {
        await flash('∃', '#6366f1');
      }
      return {
        ok: true,
        status: 'duplicate',
        id: dup.id,
        title: dup.title,
        collection: dup.collection,
      };
    }
  }"""
background = replace_once(background, old_dedupe, new_dedupe, 'authoritative duplicate handling')
background = replace_once(
    background,
    "    collection: collection ?? settings.defaultCollection,",
    "    collection: resolveSaveCollection(collection, settings.defaultCollection, explicitCollection),",
    'explicit save destination',
)
old_ai = """  const filed = await autofileSave(saved.id, { tabId: tab.id, meta }).catch(() => null);
  if (filed) await announceFiling(filed);
  return {
    ok: true,
    status: 'saved',
    id: saved.id,
    title: saved.title,
    collection: filed?.collectionId ?? saved.collection ?? input.collection,
  };"""
new_ai = """  // Acknowledge the save immediately. Best-effort enrichment starts after the
  // short Undo window; the durable alarm queue guarantees it still runs if MV3
  // suspends the worker before that timer fires.
  scheduleQueueSoon();
  setTimeout(() => {
    autofileSave(saved.id, { tabId: tab.id, meta })
      .then((result) => (result ? announceFiling(result) : undefined))
      .catch(() => {});
  }, 2500);
  return {
    ok: true,
    status: 'saved',
    id: saved.id,
    title: saved.title,
    collection: saved.collection ?? input.collection,
  };"""
background = replace_once(background, old_ai, new_ai, 'non-blocking AI filing')
background_path.write_text(background)

# ---------------------------------------------------------------------------
# Quick Bar: explicit Unsorted intent, local Recall, premium confirmations,
# better switching/focus behavior, and async action error handling.
# ---------------------------------------------------------------------------
quickbar_path = root / 'lib/quickbar.ts'
quickbar = quickbar_path.read_text()
quickbar = replace_once(
    quickbar,
    "import { buildRelatedQuery, normalizeQuickBarColor, normalizeQuickBarOrder, normalizeQuickBarUrl, rememberRecentCollection, reorderQuickBarAction, sameCanonicalUrl, splitRecentCollections } from './quickbarConfig';",
    "import { normalizeQuickBarColor, normalizeQuickBarOrder, normalizeQuickBarUrl, rememberRecentCollection, reorderQuickBarAction, splitRecentCollections } from './quickbarConfig';",
    'quickbar helper imports',
)
quickbar = replace_once(
    quickbar,
    "import { type Bookmark, type Collection, type QuickBarAction, type QuickBarCustomIcon, type QuickBarSide, type Settings } from './types';",
    "import { type Bookmark, type Collection, type QuickBarAction, type QuickBarCustomIcon, type QuickBarSide, type Settings } from './types';\nimport { type RecallItem, type RecallResult } from './recall';",
    'quickbar recall type imports',
)
quickbar = replace_once(
    quickbar,
    "    .btn:disabled { opacity: .65; }",
    "    .btn:disabled { opacity: .65; }\n    button:focus-visible, input:focus-visible, select:focus-visible, [role=\"button\"]:focus-visible { outline: 2px solid var(--ks-accent); outline-offset: 2px; }",
    'quickbar focus styles',
)
quickbar = replace_once(
    quickbar,
    "  let related: Bookmark[] = [];",
    "  let related: RecallItem[] = [];",
    'quickbar related state',
)
quickbar = replace_once(
    quickbar,
    "    relatedButton.hidden = related.length === 0;",
    "    relatedButton.hidden = !currentSettings.recallEnabled || related.length === 0;",
    'quickbar related visibility',
)
old_update = """  const updateFromSettings = (next: Settings) => {
    currentSettings = next;
    currentY = next.quickBarY;
    side = next.quickBarSide;
    collapsed = next.quickBarCollapsed;
    accent = normalizeQuickBarColor(next.quickBarColor) || ACCENTS.find((item) => item.key === next.accent)?.swatch || '#2563eb';
    host.style.setProperty('--ks-accent', accent);
    renderActions();
    applyAll();
  };"""
new_update = """  const updateFromSettings = (next: Settings) => {
    const recallChanged = next.recallEnabled !== currentSettings.recallEnabled;
    currentSettings = next;
    currentY = next.quickBarY;
    side = next.quickBarSide;
    collapsed = next.quickBarCollapsed;
    accent = normalizeQuickBarColor(next.quickBarColor) || ACCENTS.find((item) => item.key === next.accent)?.swatch || '#2563eb';
    host.style.setProperty('--ks-accent', accent);
    if (!next.recallEnabled) related = [];
    renderActions();
    applyAll();
    if (recallChanged && next.recallEnabled) window.setTimeout(() => loadRelated().catch(() => {}), 250);
  };"""
quickbar = replace_once(quickbar, old_update, new_update, 'quickbar settings recall sync')
quickbar = replace_once(
    quickbar,
    "    element.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 330))}px`;",
    "    element.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 440))}px`;",
    'quickbar popover viewport clamp',
)
old_show = """  function showMessage(message: string, actionLabel?: string, action?: () => void | Promise<void>) {
    closePopover();
    popover = buildPopover();
    const box = document.createElement('div');
    box.className = 'msg';
    box.append(document.createTextNode(message));
    if (actionLabel && action) {
      box.appendChild(document.createElement('br'));
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'link';
      link.textContent = actionLabel;
      link.onclick = action;
      box.appendChild(link);
    }
    popover.appendChild(box);
    shadow.appendChild(popover);
  }"""
new_show = """  function showMessage(message: string, actionLabel?: string, action?: () => void | Promise<void>) {
    closePopover();
    popover = buildPopover();
    const box = document.createElement('div');
    box.className = 'msg';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.append(document.createTextNode(message));
    if (actionLabel && action) {
      box.appendChild(document.createElement('br'));
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'link';
      link.textContent = actionLabel;
      link.onclick = async () => {
        link.disabled = true;
        try {
          await action();
        } catch {
          showMessage('That action could not be completed. Try again.');
        } finally {
          link.disabled = false;
        }
      };
      box.appendChild(link);
    }
    popover.appendChild(box);
    shadow.appendChild(popover);
  }"""
quickbar = replace_once(quickbar, old_show, new_show, 'quickbar accessible message actions')
quickbar = replace_once(
    quickbar,
    "  async function quickSave(collection?: string, force = false) {",
    "  async function quickSave(collection?: string, force = false, explicitCollection = false) {",
    'quickbar save signature',
)
quickbar = replace_once(
    quickbar,
    "      const response = await send<SaveCurrentPageResult>({ type: 'SAVE_CURRENT_PAGE', collection, force });",
    "      const response = await send<SaveCurrentPageResult>({ type: 'SAVE_CURRENT_PAGE', collection, force, explicitCollection });",
    'quickbar explicit save message',
)
quickbar = replace_once(
    quickbar,
    "        else quickSave(collection);",
    "        else quickSave(collection, false, true);",
    'quickbar folder destination intent',
)
quickbar = replace_once(
    quickbar,
    "        else await quickSave(created.id);",
    "        else await quickSave(created.id, false, true);",
    'quickbar created destination intent',
)
quickbar = replace_once(
    quickbar,
    "  function addBookmarkRows(container: HTMLElement, items: Bookmark[], emptyMessage: string) {",
    "  function addBookmarkRows(container: HTMLElement, items: (Bookmark | RecallItem)[], emptyMessage: string) {",
    'quickbar recall rows',
)
quickbar = replace_once(
    quickbar,
    "        id: existingBookmark!.id,\n      }).catch(() => null);",
    "        id: existingBookmark!.id,\n        url: location.href,\n      }).catch(() => null);",
    'quickbar safe refresh intent',
)
old_delete = """    addAction('Save another copy', () => quickSave(undefined, true));
    addAction('Remove from Keepsake', async () => {
      if (!window.confirm('Remove this saved item from Keepsake?')) return;
      await send({ type: 'DELETE_BOOKMARK', id: existingBookmark!.id });
      existingBookmark = null;
      paintSave();
      showMessage('Removed from Keepsake.');
    }, 'danger');
    shadow.appendChild(popover);"""
new_delete = """    addAction('Save another copy', () => quickSave(undefined, true));
    addAction('Remove from Keepsake…', () => openDeleteConfirmation(), 'danger');
    shadow.appendChild(popover);"""
quickbar = replace_once(quickbar, old_delete, new_delete, 'custom delete confirmation entry')
insert_before_search = """  async function openSearch() {"""
delete_confirmation = """  function openDeleteConfirmation() {
    if (!existingBookmark) return;
    closePopover();
    popover = buildPopover();
    const heading = document.createElement('h4');
    heading.textContent = 'Remove saved item?';
    const message = document.createElement('div');
    message.className = 'msg';
    message.textContent = 'This removes it from Keepsake. The original website is not affected.';
    const actions = document.createElement('div');
    actions.className = 'config-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'chip';
    cancel.textContent = 'Cancel';
    cancel.onclick = openDuplicateMenu;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'primary-small';
    remove.style.background = '#dc2626';
    remove.textContent = 'Remove';
    remove.onclick = async () => {
      remove.disabled = true;
      const id = existingBookmark?.id;
      if (!id) return;
      const response = await send<{ ok?: boolean; error?: string }>({ type: 'DELETE_BOOKMARK', id }).catch(() => null);
      if (!response?.ok) {
        showMessage(response?.error || 'Keepsake could not remove this save.');
        return;
      }
      existingBookmark = null;
      paintSave();
      showMessage('Removed from Keepsake.');
    };
    actions.append(cancel, remove);
    popover.append(heading, message, actions);
    shadow.appendChild(popover);
  }

"""
quickbar = replace_once(quickbar, insert_before_search, delete_confirmation + insert_before_search, 'insert delete confirmation')
old_search_run = """    let timer: number | undefined;
    const run = async () => {
      const sequence = ++searchSequence;
      const query = input.value.trim();
      results.innerHTML = '<div class="empty">Searching…</div>';
      const items = await searchBookmarks(query, { perPage: 8 }).catch(() => []);
      if (sequence !== searchSequence || !popover) return;
      addBookmarkRows(results, items.filter((item) => !item.homeOnly), query ? 'No matching saves.' : 'Your library is empty.');
    };
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 160);
    });"""
new_search_run = """    const panel = popover;
    let timer: number | undefined;
    const run = async () => {
      const sequence = ++searchSequence;
      const query = input.value.trim();
      results.innerHTML = '<div class="empty">Searching…</div>';
      const items = await searchBookmarks(query, { perPage: 8 }).catch(() => []);
      if (sequence !== searchSequence || popover !== panel) return;
      addBookmarkRows(results, items.filter((item) => !item.homeOnly), query ? 'No matching saves.' : 'Your library is empty.');
    };
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 200);
    });"""
quickbar = replace_once(quickbar, old_search_run, new_search_run, 'search stale result guard')
old_related = """  async function loadRelated() {
    if (!(await loggedIn())) return;
    const query = buildRelatedQuery(document.title, location.href);
    if (!query) return;
    const items = await searchBookmarks(query, { perPage: 10 }).catch(() => []);
    related = items
      .filter((item) => !item.homeOnly && !sameCanonicalUrl(item.url, location.href))
      .slice(0, 6);
    renderActions();
    applyTop();
  }"""
new_related = """  async function loadRelated() {
    if (!currentSettings.recallEnabled || !(await loggedIn())) {
      related = [];
      renderActions();
      return;
    }
    const response = await send<{ ok?: boolean; result?: RecallResult | null }>({ type: 'KS_GET_RECALL' }).catch(() => null);
    const result = response?.result;
    related = result?.url === location.href ? result.semantic.slice(0, 6) : [];
    renderActions();
    applyTop();
  }"""
quickbar = replace_once(quickbar, old_related, new_related, 'local related recall')
quickbar = replace_once(
    quickbar,
    "  searchButton.onclick = () => (popover ? closePopover() : openSearch());\n  relatedButton.onclick = () => (popover ? closePopover() : openRelated());\n  saveButton.onclick = () => quickSave();\n  folderButton.onclick = () => (popover ? closePopover() : openFolders(Boolean(existingBookmark)));",
    "  searchButton.onclick = openSearch;\n  relatedButton.onclick = openRelated;\n  saveButton.onclick = () => quickSave();\n  folderButton.onclick = () => openFolders(Boolean(existingBookmark));",
    'quickbar one-click panel switching',
)
quickbar = replace_once(
    quickbar,
    "  customizeButton.onclick = () => (popover ? closePopover() : openCustomize());",
    "  customizeButton.onclick = openCustomize;",
    'quickbar one-click customization',
)
quickbar = replace_once(
    quickbar,
    "    await refreshExisting();\n    loadRelated().catch(() => {});",
    "    await refreshExisting();\n    if (currentSettings.recallEnabled) window.setTimeout(() => loadRelated().catch(() => {}), 700);",
    'idle related load',
)
quickbar_path.write_text(quickbar)

# Settings copy: clarify that Related uses the existing private Ambient Recall
# setting and that dock customization stays in the gear menu instead of adding
# more top-level switches.
settings_path = root / 'components/SettingsPanel.tsx'
settings = settings_path.read_text()
settings = replace_once(
    settings,
    'label="Show related saves while browsing (badge + side panel)"',
    'label="Show related saves while browsing (toolbar badge, Quick Bar + side panel)"',
    'Ambient Recall label',
)
settings = replace_once(
    settings,
    'hint="The Quick Bar is a draggable widget on the edge of every page. Shortcut: Ctrl+Shift+K pops the folder picker."',
    'hint="The Quick Bar is a draggable widget on the edge of every page. Use its gear to reorder buttons, change size/color, or add a custom shortcut. Ctrl+Shift+K opens the folder picker."',
    'Quick Bar settings hint',
)
settings_path.write_text(settings)

print('Keepsake 8.10.4 hardening source generated successfully.')
