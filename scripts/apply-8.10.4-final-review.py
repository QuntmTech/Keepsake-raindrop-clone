from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


root = Path(__file__).resolve().parents[1]
background_path = root / 'entrypoints/background.ts'
background = background_path.read_text()
background = replace_once(
    background,
    "        await updateBookmark(dup.id, { collection: destination }).catch(() => {});",
    "        await updateBookmark(dup.id, { collection: destination });",
    'duplicate move error propagation',
)
old_capture = """  const meta = settings.enableMetadata ? await extractMeta(tab.id) : null;

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
  }"""
new_capture = """  // Metadata extraction and screenshot work are independent. Run them in
  // parallel so a rich save costs roughly the slower task, not both combined.
  const metaPromise = settings.enableMetadata ? extractMeta(tab.id) : Promise.resolve(null);
  const screenshotPromise: Promise<Blob | undefined> = settings.enableAutoScreenshot
    ? (async () => {
        const storageState = await storageRemaining();
        if (!storageState.unlimited && storageState.remaining !== null && storageState.remaining <= 0) return undefined;
        try {
          return dataUrlToBlob(await captureVisibleTab());
        } catch {
          return undefined; // protected pages still save without a screenshot
        }
      })()
    : Promise.resolve(undefined);
  const [meta, screenshotBlob] = await Promise.all([metaPromise, screenshotPromise]);"""
background = replace_once(background, old_capture, new_capture, 'parallel save preparation')
old_recall = """      let cache = await recallCache.getValue();
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
      return { ok: true, result };"""
new_recall = """      let cache = await recallCache.getValue();
      let result = tabId != null ? cache[tabId] ?? null : null;
      // The Quick Bar can beat webNavigation's cache write, and SPAs can change
      // URL without a full navigation. Recompute when missing OR stale, still
      // entirely locally and only when the user's setting/blocklist allows it.
      if (tabId != null) {
        const tab = await browser.tabs.get(tabId).catch(() => null);
        if (tab?.url && (!result || result.url !== tab.url) && (await recallAllowed(tab.url))) {
          await runRecall(tabId, tab.url).catch(() => {});
          cache = await recallCache.getValue();
          result = cache[tabId] ?? null;
        }
      }
      return { ok: true, result };"""
background = replace_once(background, old_recall, new_recall, 'stale recall refresh')
background_path.write_text(background)

quickbar_path = root / 'lib/quickbar.ts'
quickbar = quickbar_path.read_text()
old_new_folder = """    newFolder.onclick = async () => {
      const name = window.prompt('New collection name')?.trim();
      if (!name) return;
      try {
        const created = await createCollection({ name });
        collectionCache = null;
        if (moveMode) await moveExisting(created.id);
        else await quickSave(created.id, false, true);
      } catch {
        showMessage('The collection could not be created. Try again.');
      }
    };"""
new_new_folder = """    newFolder.onclick = () => openCreateCollection(moveMode);"""
quickbar = replace_once(quickbar, old_new_folder, new_new_folder, 'remove browser collection prompt')
insert_marker = """  function addBookmarkRows(container: HTMLElement, items: (Bookmark | RecallItem)[], emptyMessage: string) {"""
create_collection = """  function openCreateCollection(moveMode: boolean) {
    closePopover();
    popover = buildPopover();
    const heading = document.createElement('h4');
    heading.textContent = 'New collection';
    const input = document.createElement('input');
    input.className = 'search-input';
    input.placeholder = 'Collection name';
    input.maxLength = 80;
    const actions = document.createElement('div');
    actions.className = 'config-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'chip';
    cancel.textContent = 'Cancel';
    cancel.onclick = () => openFolders(moveMode);
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'primary-small';
    create.textContent = moveMode ? 'Create & move' : 'Create & save';
    const submit = async () => {
      const name = input.value.trim();
      if (!name) {
        input.focus();
        return;
      }
      create.disabled = true;
      try {
        const created = await createCollection({ name });
        collectionCache = null;
        if (moveMode) await moveExisting(created.id);
        else await quickSave(created.id, false, true);
      } catch {
        showMessage('The collection could not be created. Try again.');
      } finally {
        create.disabled = false;
      }
    };
    create.onclick = submit;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    actions.append(cancel, create);
    popover.append(heading, input, actions);
    shadow.appendChild(popover);
    input.focus();
  }

"""
quickbar = replace_once(quickbar, insert_marker, create_collection + insert_marker, 'inline collection creation')
quickbar_path.write_text(quickbar)

print('Keepsake 8.10.4 final review patch generated successfully.')
