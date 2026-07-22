from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f"{label}: start marker not found")
    end = text.find(end_marker, start)
    if end < 0:
        raise RuntimeError(f"{label}: end marker not found")
    return text[:start] + replacement + text[end:]


root = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# Background worker: return save receipts and own undo/move/refresh mutations.
# ---------------------------------------------------------------------------
background_path = root / "entrypoints/background.ts"
background = background_path.read_text()
background = replace_once(
    background,
    "import { type Message, type ScreenshotResult, type MetaResult, dataUrlToBlob } from '@/lib/messaging';",
    "import { type Message, type ScreenshotResult, type MetaResult, type SaveCurrentPageResult, dataUrlToBlob } from '@/lib/messaging';",
    "background messaging import",
)
background = replace_once(
    background,
    "import { searchBookmarks, updateBookmark } from '@/lib/bookmarks';",
    "import { deleteBookmark, searchBookmarks, updateBookmark } from '@/lib/bookmarks';",
    "background bookmark import",
)
background = replace_once(
    background,
    "    case 'SAVE_CURRENT_PAGE': {\n      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });\n      if (tab) await saveTab(tab, msg.collection);\n      return { ok: true };\n    }",
    "    case 'SAVE_CURRENT_PAGE': {\n      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });\n      if (!tab) return { ok: false, status: 'blocked', error: 'No active tab' } satisfies SaveCurrentPageResult;\n      return saveTab(tab, msg.collection, Boolean(msg.force));\n    }\n\n    case 'DELETE_BOOKMARK':\n      await deleteBookmark(msg.id);\n      return { ok: true };\n\n    case 'MOVE_BOOKMARK': {\n      const bookmark = await updateBookmark(msg.id, { collection: msg.collection || '' });\n      return { ok: true, bookmark };\n    }\n\n    case 'REFRESH_BOOKMARK': {\n      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });\n      if (!tab?.url) return { ok: false, error: 'No active page to refresh from.' };\n      const meta = await extractMeta(tab.id);\n      const bookmark = await updateBookmark(msg.id, {\n        url: tab.url,\n        title: meta?.title || tab.title || tab.url,\n        description: meta?.description,\n        content: meta?.text,\n        cover: meta?.cover,\n        favicon: meta?.favicon,\n        domain: safeDomain(tab.url),\n        type: meta?.type ?? inferType(tab.url),\n        readingTime: meta?.readingTime,\n      });\n      return { ok: true, bookmark };\n    }",
    "background save management cases",
)

new_save_tab = r'''async function saveTab(
  tab: chrome.tabs.Tab,
  collection?: string,
  force = false,
): Promise<SaveCurrentPageResult> {
  if (!tab.url) return { ok: false, status: 'blocked', error: 'This page has no URL.' };
  await getBackend();
  const settings = await getSettings();

  // Normal clicks never create accidental copies. The Quick Bar exposes an
  // explicit "Save another copy" action that passes force=true.
  if (!force) {
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
  }

  const cap = await canSaveBookmark();
  if (!cap.allowed) {
    await flash('★', '#f59e0b');
    notifyUpgrade(
      'ks-upgrade-bookmarks-',
      "You've reached your Free plan's bookmark limit",
      `${cap.used}/${cap.limit} cloud bookmarks used. Upgrade to Pro for unlimited bookmarks, the full Capture Studio, and 25 watches.`,
    );
    return { ok: false, status: 'blocked', error: 'Free plan bookmark limit reached.' };
  }

  const meta = settings.enableMetadata ? await extractMeta(tab.id) : null;

  let screenshotBlob: Blob | undefined;
  if (settings.enableAutoScreenshot) {
    const storageState = await storageRemaining();
    if (storageState.unlimited || storageState.remaining === null || storageState.remaining > 0) {
      try {
        screenshotBlob = dataUrlToBlob(await captureVisibleTab());
      } catch {
        /* protected pages still save without a screenshot */
      }
    }
  }

  const input = {
    url: tab.url,
    title: meta?.title || tab.title || tab.url,
    description: meta?.description,
    content: meta?.text,
    collection: collection ?? settings.defaultCollection,
    cover: meta?.cover,
    favicon: meta?.favicon,
    domain: safeDomain(tab.url),
    type: meta?.type ?? inferType(tab.url),
    readingTime: meta?.readingTime,
    screenshotBlob,
  };

  let saved;
  try {
    saved = await saveBookmark(input);
    await flash('✓', '#16a34a');
  } catch (error) {
    if ((error as { status?: number })?.status === 402) {
      await flash('★', '#f59e0b');
      notifyUpgrade(
        'ks-upgrade-bookmarks-',
        "You've reached your Free plan's bookmark limit",
        'Upgrade to Pro for unlimited cloud bookmarks, the full Capture Studio, and 25 watches.',
      );
      return { ok: false, status: 'blocked', error: 'Free plan bookmark limit reached.' };
    }
    await enqueueSave(input);
    await flash('…', '#f59e0b');
    return { ok: true, status: 'queued', title: input.title, collection: input.collection };
  }

  const filed = await autofileSave(saved.id, { tabId: tab.id, meta }).catch(() => null);
  if (filed) await announceFiling(filed);
  return {
    ok: true,
    status: 'saved',
    id: saved.id,
    title: saved.title,
    collection: filed?.collectionId ?? saved.collection ?? input.collection,
  };
}

'''
background = replace_between(
    background,
    "async function saveTab(",
    "async function announceFiling",
    new_save_tab,
    "saveTab replacement",
)
background_path.write_text(background)

# ---------------------------------------------------------------------------
# Quick Bar: search, related results, recent folders, undo and duplicate menu.
# ---------------------------------------------------------------------------
quickbar_path = root / "lib/quickbar.ts"
quickbar = quickbar_path.read_text()
quickbar = replace_once(
    quickbar,
    "import { listCollections, createCollection, findByUrl } from './bookmarks';",
    "import { listCollections, createCollection, findByUrl, searchBookmarks } from './bookmarks';",
    "quickbar bookmark imports",
)
quickbar = replace_once(
    quickbar,
    "import { send } from './messaging';",
    "import { send, type SaveCurrentPageResult } from './messaging';",
    "quickbar messaging imports",
)
quickbar = replace_once(
    quickbar,
    "import { normalizeQuickBarColor, normalizeQuickBarOrder, normalizeQuickBarUrl, reorderQuickBarAction } from './quickbarConfig';",
    "import { buildRelatedQuery, normalizeQuickBarColor, normalizeQuickBarOrder, normalizeQuickBarUrl, rememberRecentCollection, reorderQuickBarAction, sameCanonicalUrl, splitRecentCollections } from './quickbarConfig';",
    "quickbar config imports",
)
quickbar = replace_once(
    quickbar,
    "import { type Collection, type QuickBarAction, type QuickBarCustomIcon, type QuickBarSide, type Settings } from './types';",
    "import { type Bookmark, type Collection, type QuickBarAction, type QuickBarCustomIcon, type QuickBarSide, type Settings } from './types';",
    "quickbar type imports",
)
quickbar = replace_once(
    quickbar,
    "  star: '<path d=\"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z\"/>',",
    "  star: '<path d=\"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z\"/>',\n  search: '<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-4-4\"/>',\n  related: '<path d=\"M8 6h11M5 6h.01M8 12h11M5 12h.01M8 18h11M5 18h.01\"/>',\n  refresh: '<path d=\"M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7\"/>',\n  trash: '<path d=\"M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13\"/>',",
    "quickbar command icons",
)
quickbar = replace_once(
    quickbar,
    "    .badge { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%;\n      background: #34d399; box-shadow: 0 0 0 2px rgba(24,26,32,.94); }",
    "    .badge { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%;\n      background: #34d399; box-shadow: 0 0 0 2px rgba(24,26,32,.94); }\n    .count { position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; display: grid; place-items: center;\n      padding: 0 4px; border-radius: 99px; background: #f59e0b; color: #111827; font-size: 9px; font-weight: 800;\n      box-shadow: 0 0 0 2px rgba(24,26,32,.96); }\n    .btn.related { position: relative; }",
    "quickbar count badge css",
)
quickbar = replace_once(
    quickbar,
    "    .primary-small { border: none; border-radius: 8px; background: var(--ks-accent); color: #fff; padding: 8px 10px; cursor: pointer; font-size: 11px; font-weight: 700; }",
    "    .primary-small { border: none; border-radius: 8px; background: var(--ks-accent); color: #fff; padding: 8px 10px; cursor: pointer; font-size: 11px; font-weight: 700; }\n    .pop.wide { width: min(340px, calc(100vw - 76px)); }\n    .section-title { margin: 8px 8px 3px; color: rgba(255,255,255,.42); font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .06em; }\n    .search-input { width: calc(100% - 8px); margin: 0 4px 7px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: rgba(255,255,255,.07); color: #fff; padding: 10px 11px; outline: none; font: 13px ui-sans-serif,system-ui; }\n    .search-input:focus { border-color: var(--ks-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ks-accent) 25%, transparent); }\n    .result { align-items: flex-start; padding: 9px 10px; }\n    .result-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }\n    .result-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; font-size: 12px; font-weight: 650; }\n    .result-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.48); font-size: 10px; }\n    .empty { padding: 18px 12px; color: rgba(255,255,255,.52); font-size: 12px; text-align: center; }\n    .danger { color: #fca5a5; }\n    .saved-card { margin: 4px; padding: 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: rgba(255,255,255,.045); }\n    .saved-title { margin: 0 0 4px; color: #fff; font-size: 12px; font-weight: 700; line-height: 1.35; }\n    .saved-meta { margin: 0; color: rgba(255,255,255,.5); font-size: 10px; }",
    "quickbar command css",
)
quickbar = replace_once(
    quickbar,
    "      <button class=\"btn action popup\" draggable=\"true\" data-action=\"popup\" type=\"button\" aria-label=\"Open Keepsake dropdown\" title=\"Open Keepsake dropdown\">${icon('popup')}</button>\n      <button class=\"btn action save\" draggable=\"true\" data-action=\"save\" type=\"button\" aria-label=\"Save this page\" title=\"Save this page\">${icon('bookmark', true)}</button>",
    "      <button class=\"btn action popup\" draggable=\"true\" data-action=\"popup\" type=\"button\" aria-label=\"Open Keepsake dropdown\" title=\"Open Keepsake dropdown\">${icon('popup')}</button>\n      <button class=\"btn action search\" draggable=\"true\" data-action=\"search\" type=\"button\" aria-label=\"Search Keepsake\" title=\"Search Keepsake\">${icon('search')}</button>\n      <button class=\"btn action related\" draggable=\"true\" data-action=\"related\" type=\"button\" aria-label=\"Related saves\" title=\"Related saves\" hidden>${icon('related')}</button>\n      <button class=\"btn action save\" draggable=\"true\" data-action=\"save\" type=\"button\" aria-label=\"Save this page\" title=\"Save this page\">${icon('bookmark', true)}</button>",
    "quickbar command buttons",
)
quickbar = replace_once(
    quickbar,
    "  const popupButton = rail.querySelector('.btn.popup') as HTMLButtonElement;\n  const saveButton = rail.querySelector('.btn.save') as HTMLButtonElement;",
    "  const popupButton = rail.querySelector('.btn.popup') as HTMLButtonElement;\n  const searchButton = rail.querySelector('.btn.search') as HTMLButtonElement;\n  const relatedButton = rail.querySelector('.btn.related') as HTMLButtonElement;\n  const saveButton = rail.querySelector('.btn.save') as HTMLButtonElement;",
    "quickbar command button queries",
)
quickbar = replace_once(
    quickbar,
    "  let saving = false;\n  let saved = false;",
    "  let saving = false;\n  let existing: Bookmark | null = null;\n  let related: Bookmark[] = [];\n  let collectionCache: { items: Collection[]; at: number } | null = null;\n  let searchSequence = 0;",
    "quickbar command state",
)
quickbar = replace_once(
    quickbar,
    "      popup: popupButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,",
    "      popup: popupButton, search: searchButton, related: relatedButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,",
    "quickbar action map",
)
quickbar = replace_once(
    quickbar,
    "    customButton.hidden = !customUrl;",
    "    customButton.hidden = !customUrl;\n    relatedButton.hidden = related.length === 0;\n    relatedButton.innerHTML = `${icon('related')}<span class=\"count\">${Math.min(99, related.length)}</span>`;",
    "quickbar related action rendering",
)
quickbar = replace_once(
    quickbar,
    "  for (const button of [popupButton, saveButton, folderButton, dashboardButton, customButton]) {",
    "  for (const button of [popupButton, searchButton, relatedButton, saveButton, folderButton, dashboardButton, customButton]) {",
    "quickbar draggable actions",
)
quickbar = replace_once(
    quickbar,
    "  function showMessage(message: string, actionLabel?: string, action?: () => void) {",
    "  function showMessage(message: string, actionLabel?: string, action?: () => void | Promise<void>) {",
    "quickbar async message action",
)

command_block = r'''  const saveIcon = icon('bookmark', true);
  const paintSave = () => {
    saveButton.innerHTML = saveIcon;
    if (existing) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      saveButton.appendChild(badge);
    }
    saveButton.title = existing ? 'Already saved — manage saved item' : 'Save this page';
  };

  const loadCollections = async (): Promise<Collection[]> => {
    if (collectionCache && Date.now() - collectionCache.at < 60_000) return collectionCache.items;
    const items = await listCollections();
    collectionCache = { items, at: Date.now() };
    return items;
  };

  const collectionLabel = async (id?: string): Promise<string> => {
    if (!id) return 'Unsorted';
    const item = (await loadCollections().catch(() => [])).find((collection) => collection.id === id);
    return item?.name || 'your collection';
  };

  const rememberCollection = async (id?: string) => {
    if (!id) return;
    const next = rememberRecentCollection(currentSettings.quickBarRecentCollections, id);
    if (next.join('|') !== currentSettings.quickBarRecentCollections.join('|')) {
      updateFromSettings(await setSettings({ quickBarRecentCollections: next }));
    }
  };

  const refreshExisting = async () => {
    existing = await findByUrl(location.href).catch(() => null);
    paintSave();
  };

  async function quickSave(collection?: string, force = false) {
    if (saving) return;
    if (existing && !force && collection === undefined) {
      openDuplicateMenu();
      return;
    }
    if (!(await loggedIn())) {
      showMessage('Sign in to Keepsake before saving.', 'Open Keepsake →', () => {
        send({ type: 'OPEN_DASHBOARD' });
        closePopover();
      });
      return;
    }

    saving = true;
    setButtonBusy(saveButton, true);
    setButtonBusy(folderButton, true);
    saveButton.innerHTML = '<span class="spinner"></span>';
    try {
      const response = await send<SaveCurrentPageResult>({ type: 'SAVE_CURRENT_PAGE', collection, force });
      if (!response?.ok && response?.status !== 'queued') throw new Error(response?.error || 'The page could not be saved');
      if (response.status === 'duplicate') {
        await refreshExisting();
        openDuplicateMenu();
        return;
      }
      if (response.status === 'queued') {
        paintSave();
        showMessage('Saved offline — Keepsake will sync it automatically when your connection returns.');
        return;
      }

      await rememberCollection(collection || response.collection);
      await refreshExisting();
      saveButton.classList.add('ok');
      saveButton.innerHTML = icon('check');
      const destination = await collectionLabel(response.collection || collection);
      showMessage(`Saved to ${destination}.`, response.id ? 'Undo' : undefined, response.id ? async () => {
        await send({ type: 'DELETE_BOOKMARK', id: response.id! });
        existing = null;
        paintSave();
        showMessage('Save undone.');
      } : undefined);
      setTimeout(() => {
        saveButton.classList.remove('ok');
        paintSave();
      }, 1100);
    } catch (error) {
      await refreshExisting();
      showMessage((error as Error)?.message || 'Keepsake could not save this page. Try again.');
    } finally {
      saving = false;
      setButtonBusy(saveButton, false);
      setButtonBusy(folderButton, false);
    }
  }

  async function moveExisting(collection?: string) {
    if (!existing) return;
    const response = await send<{ ok?: boolean; bookmark?: Bookmark; error?: string }>({
      type: 'MOVE_BOOKMARK',
      id: existing.id,
      collection,
    }).catch(() => null);
    if (!response?.ok) {
      showMessage(response?.error || 'Keepsake could not move this save.');
      return;
    }
    existing = response.bookmark ?? { ...existing, collection };
    await rememberCollection(collection);
    paintSave();
    showMessage(`Moved to ${await collectionLabel(collection)}.`);
  }

  async function openFolders(moveMode = Boolean(existing)) {
    if (!(await loggedIn())) {
      showMessage('Sign in to Keepsake before saving.', 'Open Keepsake →', () => send({ type: 'OPEN_DASHBOARD' }));
      return;
    }

    closePopover();
    popover = buildPopover();
    const heading = document.createElement('h4');
    heading.textContent = moveMode ? 'Move saved item to…' : 'Save to…';
    popover.appendChild(heading);
    shadow.appendChild(popover);

    const addSection = (label: string) => {
      if (!popover) return;
      const title = document.createElement('div');
      title.className = 'section-title';
      title.textContent = label;
      popover.appendChild(title);
    };

    const addRow = (label: string, color: string, collection?: string) => {
      if (!popover) return;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = color;
      const text = document.createElement('span');
      text.textContent = label;
      row.append(dot, text);
      row.onclick = () => {
        if (moveMode) moveExisting(collection);
        else quickSave(collection);
      };
      popover.appendChild(row);
    };

    try {
      const collections = await loadCollections();
      const { recent, rest } = splitRecentCollections(collections, currentSettings.quickBarRecentCollections);
      if (recent.length) {
        addSection('Recent');
        for (const collection of recent) {
          addRow(`${collection.icon ? `${collection.icon} ` : ''}${collection.name}`, collection.color || accent, collection.id);
        }
      }
      addSection(recent.length ? 'All collections' : 'Collections');
      addRow('Unsorted', 'rgba(255,255,255,.35)');
      for (const collection of rest) {
        addRow(`${collection.icon ? `${collection.icon} ` : ''}${collection.name}`, collection.color || accent, collection.id);
      }
    } catch {
      showMessage('Collections could not be loaded. Try again.');
      return;
    }

    if (!popover) return;
    const newFolder = document.createElement('button');
    newFolder.type = 'button';
    newFolder.className = 'row';
    newFolder.style.color = accent;
    newFolder.innerHTML = icon('plus');
    const label = document.createElement('span');
    label.textContent = 'New collection…';
    newFolder.appendChild(label);
    newFolder.onclick = async () => {
      const name = window.prompt('New collection name')?.trim();
      if (!name) return;
      try {
        const created = await createCollection({ name });
        collectionCache = null;
        if (moveMode) await moveExisting(created.id);
        else await quickSave(created.id);
      } catch {
        showMessage('The collection could not be created. Try again.');
      }
    };
    popover.appendChild(newFolder);
  }

  function addBookmarkRows(container: HTMLElement, items: Bookmark[], emptyMessage: string) {
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = emptyMessage;
      container.appendChild(empty);
      return;
    }
    for (const bookmark of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row result';
      const copy = document.createElement('span');
      copy.className = 'result-copy';
      const title = document.createElement('span');
      title.className = 'result-title';
      title.textContent = bookmark.title || bookmark.url;
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      meta.textContent = bookmark.domain || (() => {
        try { return new URL(bookmark.url).hostname; } catch { return bookmark.url; }
      })();
      copy.append(title, meta);
      row.appendChild(copy);
      row.onclick = () => {
        send({ type: 'OPEN_URL', url: bookmark.url });
        closePopover();
      };
      container.appendChild(row);
    }
  }

  function openDuplicateMenu() {
    if (!existing) return;
    closePopover();
    popover = buildPopover();
    popover.classList.add('wide');
    const heading = document.createElement('h4');
    heading.textContent = 'Already saved';
    popover.appendChild(heading);

    const card = document.createElement('div');
    card.className = 'saved-card';
    const title = document.createElement('p');
    title.className = 'saved-title';
    title.textContent = existing.title || existing.url;
    const meta = document.createElement('p');
    meta.className = 'saved-meta';
    meta.textContent = existing.collection ? 'Stored in a collection' : 'Stored in Unsorted';
    card.append(title, meta);
    popover.appendChild(card);

    const addAction = (label: string, action: () => void | Promise<void>, className = '') => {
      if (!popover) return;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `row ${className}`.trim();
      row.textContent = label;
      row.onclick = action;
      popover.appendChild(row);
    };

    addAction('Refresh saved title and page details', async () => {
      const response = await send<{ ok?: boolean; bookmark?: Bookmark; error?: string }>({
        type: 'REFRESH_BOOKMARK',
        id: existing!.id,
      }).catch(() => null);
      if (!response?.ok) {
        showMessage(response?.error || 'Keepsake could not refresh this save.');
        return;
      }
      existing = response.bookmark ?? existing;
      paintSave();
      showMessage('Saved copy refreshed from the current page.');
    });
    addAction('Move to another collection…', () => openFolders(true));
    addAction('Save another copy', () => quickSave(undefined, true));
    addAction('Remove from Keepsake', async () => {
      if (!window.confirm('Remove this saved item from Keepsake?')) return;
      await send({ type: 'DELETE_BOOKMARK', id: existing!.id });
      existing = null;
      paintSave();
      showMessage('Removed from Keepsake.');
    }, 'danger');
    shadow.appendChild(popover);
  }

  async function openSearch() {
    closePopover();
    popover = buildPopover();
    popover.classList.add('wide');
    const heading = document.createElement('h4');
    heading.textContent = 'Search Keepsake';
    const input = document.createElement('input');
    input.className = 'search-input';
    input.type = 'search';
    input.placeholder = 'Search titles, notes, tags…';
    const results = document.createElement('div');
    popover.append(heading, input, results);
    shadow.appendChild(popover);

    let timer: number | undefined;
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
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') (results.querySelector('button') as HTMLButtonElement | null)?.click();
    });
    await run();
    input.focus();
  }

  async function loadRelated() {
    if (!(await loggedIn())) return;
    const query = buildRelatedQuery(document.title, location.href);
    if (!query) return;
    const items = await searchBookmarks(query, { perPage: 10 }).catch(() => []);
    related = items
      .filter((item) => !item.homeOnly && !sameCanonicalUrl(item.url, location.href))
      .slice(0, 6);
    renderActions();
    applyTop();
  }

  function openRelated() {
    closePopover();
    popover = buildPopover();
    popover.classList.add('wide');
    const heading = document.createElement('h4');
    heading.textContent = `Related saves (${related.length})`;
    const results = document.createElement('div');
    addBookmarkRows(results, related, 'No related saves found for this page.');
    popover.append(heading, results);
    shadow.appendChild(popover);
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closePopover();
  };
  document.addEventListener('keydown', onKeydown, true);

'''
quickbar = replace_between(
    quickbar,
    "  const saveIcon = icon('bookmark', true);",
    "  async function openDropdown()",
    command_block,
    "quickbar command block",
)
quickbar = replace_once(
    quickbar,
    "    hint.textContent = 'Drag the four action buttons directly on the dock to reorder them.';",
    "    hint.textContent = 'Drag any action button directly on the dock to reorder it.';",
    "quickbar customize hint",
)
quickbar = replace_once(
    quickbar,
    "      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'save', 'folder', 'dashboard', 'custom'] }));",
    "      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'search', 'related', 'save', 'folder', 'dashboard', 'custom'] }));",
    "quickbar reset order",
)
quickbar = replace_once(
    quickbar,
    "  popupButton.onclick = openDropdown;\n  saveButton.onclick = () => quickSave();\n  folderButton.onclick = () => (popover ? closePopover() : openFolders());",
    "  popupButton.onclick = openDropdown;\n  searchButton.onclick = () => (popover ? closePopover() : openSearch());\n  relatedButton.onclick = () => (popover ? closePopover() : openRelated());\n  saveButton.onclick = () => quickSave();\n  folderButton.onclick = () => (popover ? closePopover() : openFolders(Boolean(existing)));",
    "quickbar action handlers",
)
quickbar = replace_once(
    quickbar,
    "  if (await loggedIn()) {\n    try {\n      saved = Boolean(await findByUrl(location.href));\n      paintSave();\n    } catch {\n      paintSave();\n    }\n  } else {\n    paintSave();\n  }",
    "  if (await loggedIn()) {\n    await refreshExisting();\n    loadRelated().catch(() => {});\n  } else {\n    paintSave();\n  }",
    "quickbar initial intelligence",
)
quickbar = replace_once(
    quickbar,
    "      document.removeEventListener('click', onDocumentClick);\n      host.remove();",
    "      document.removeEventListener('click', onDocumentClick);\n      document.removeEventListener('keydown', onKeydown, true);\n      host.remove();",
    "quickbar cleanup",
)
quickbar_path.write_text(quickbar)

print('Quick Bar command center source generated successfully.')
