import { storage } from 'wxt/utils/storage';
import { getSettings, setSettings } from './settings';
import { getBackend } from './backend';
import { listCollections, createCollection, findByUrl } from './bookmarks';
import { send } from './messaging';
import { ACCENTS } from './theme';
import { type Collection } from './types';

// Whether the bar is collapsed to an edge tab (persisted, roams across devices).
const collapsedStore = storage.defineItem<boolean>('local:quickbar_collapsed', { fallback: false });

// An in-page "Quick Bar": a small, draggable widget pinned to the right edge of
// every page. Save the current page in one click, drop it straight into a
// folder, or jump to the dashboard — without ever opening the toolbar popup.
// Rendered inside a Shadow DOM so no website's CSS can interfere with it.

export interface QuickBarApi {
  openFolders: () => void;
  destroy: () => void;
}

const SVG = {
  grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  bookmark: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronR: '<path d="M9 6l6 6-6 6"/>',
  chevronL: '<path d="M15 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};

function icon(name: keyof typeof SVG, fill = false): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SVG[name]}</svg>`;
}

export async function mountQuickBar(): Promise<QuickBarApi | null> {
  if (document.getElementById('keepsake-quickbar')) return null;

  const settings = await getSettings();
  const accent = ACCENTS.find((a) => a.key === settings.accent)?.swatch ?? '#2563eb';

  const host = document.createElement('div');
  host.id = 'keepsake-quickbar';
  const shadow = host.attachShadow({ mode: 'open' });
  (document.documentElement || document.body).appendChild(host);

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .rail { position: fixed; right: 0; z-index: 2147483000;
      display: flex; flex-direction: column; align-items: center; gap: 3px;
      padding: 7px 5px; background: linear-gradient(180deg, rgba(32,34,44,.94), rgba(18,20,27,.96));
      backdrop-filter: blur(12px) saturate(1.3); -webkit-backdrop-filter: blur(12px) saturate(1.3);
      border: 1px solid rgba(255,255,255,.09); border-right: none;
      border-radius: 16px 0 0 16px;
      box-shadow: 0 10px 32px rgba(0,0,0,.35), 0 2px 8px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.06);
      font-family: ui-sans-serif, system-ui, sans-serif; transition: opacity .2s, transform .15s;
      opacity: .6; }
    .rail:hover { opacity: 1; transform: translateX(-1px); }
    .grip { color: rgba(255,255,255,.4); cursor: grab; padding: 2px 0; touch-action: none; }
    .grip:active { cursor: grabbing; }
    .hide { width: 38px; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.35);
      background: transparent; border: none; border-radius: 8px; cursor: pointer; opacity: 0;
      transition: opacity .15s, color .12s; }
    .rail:hover .hide { opacity: 1; }
    .hide:hover { color: #fff; background: rgba(255,255,255,.12); }
    .collapse { width: 38px; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.4);
      background: transparent; border: none; border-radius: 8px; cursor: pointer; opacity: 0;
      transition: opacity .15s, color .12s; }
    .rail:hover .collapse { opacity: 1; }
    .collapse:hover { color: #fff; background: rgba(255,255,255,.12); }
    .tab { position: fixed; right: 0; z-index: 2147483000; display: none; align-items: center;
      width: 16px; height: 54px; padding: 0; border: none; cursor: pointer; color: rgba(255,255,255,.9);
      background: rgba(24,26,32,.92); backdrop-filter: blur(8px); border-radius: 10px 0 0 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,.3); transition: width .15s, opacity .2s; opacity: .5; overflow: hidden; }
    .tab:hover { width: 30px; opacity: 1; }
    .tab svg { flex: none; }
    .tab .tabmark { display: none; }
    .tab:hover .tabmark { display: inline-grid; place-items: center; color: ${accent}; }
    .btn { width: 38px; height: 38px; display: grid; place-items: center; color: rgba(255,255,255,.9);
      background: transparent; border: none; border-radius: 11px; cursor: pointer;
      transition: background .12s, transform .12s, color .12s, box-shadow .12s; }
    .btn:hover { background: rgba(255,255,255,.12); color: #fff; transform: scale(1.06); }
    .btn:active { transform: scale(.92); }
    .btn.save { position: relative; color: #fff;
      background: linear-gradient(135deg, ${accent}, ${accent}dd);
      box-shadow: 0 3px 10px ${accent}55; }
    .btn.save:hover { filter: brightness(1.12); transform: scale(1.06); }
    .btn.ok { color: #34d399; background: rgba(52,211,153,.15); box-shadow: none; }
    .badge { position: absolute; top: 5px; right: 5px; width: 8px; height: 8px;
      border-radius: 50%; background: #34d399; box-shadow: 0 0 0 2px rgba(24,26,32,.92); }
    .pop { position: fixed; z-index: 2147483001; width: 230px; max-height: 60vh; overflow:auto;
      background: #1b1d24; color: #eef; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.4);
      padding: 8px; font-family: ui-sans-serif, system-ui, sans-serif; }
    .pop h4 { margin: 4px 8px 8px; font-size: 11px; text-transform: uppercase;
      letter-spacing: .04em; color: rgba(255,255,255,.45); font-weight: 600; }
    .row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px;
      background: transparent; border: none; border-radius: 8px; cursor: pointer;
      color: #eef; font-size: 13px; text-align: left; }
    .row:hover { background: rgba(255,255,255,.08); }
    .row svg { width: 16px; height: 16px; flex: none; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .msg { padding: 14px 12px; font-size: 13px; color: rgba(255,255,255,.7); text-align: center; }
    .link { color: ${accent}; cursor: pointer; text-decoration: underline; }
  `;
  shadow.appendChild(style);

  const rail = document.createElement('div');
  rail.className = 'rail';
  rail.innerHTML = `
    <button class="hide" title="Hide the Quick Bar (turn it back on in the Keepsake popup → Settings)">${icon('close')}</button>
    <button class="collapse" title="Collapse to the edge">${icon('chevronR')}</button>
    <div class="grip" title="Drag to move">${icon('grip')}</div>
    <button class="btn save" title="Save this page">${icon('bookmark', true)}</button>
    <button class="btn folder" title="Save to folder">${icon('folder')}</button>
    <button class="btn dash" title="Open Keepsake">${icon('grid')}</button>
  `;
  shadow.appendChild(rail);

  // Collapsed edge tab — peeks from the right; click to expand.
  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.title = 'Open Keepsake Quick Bar';
  tab.innerHTML = icon('chevronL') + `<span class="tabmark">${icon('bookmark', true)}</span>`;
  shadow.appendChild(tab);

  // ---- position (vertical) ----
  let curY = settings.quickBarY;
  const clampTop = (frac: number) => {
    const h = rail.offsetHeight || 180;
    const max = window.innerHeight - h - 8;
    return Math.max(8, Math.min(max, frac * window.innerHeight - h / 2));
  };
  const applyTop = () => {
    rail.style.top = `${clampTop(curY)}px`;
    tab.style.top = `${Math.max(8, Math.min(window.innerHeight - 62, curY * window.innerHeight - 27))}px`;
  };
  applyTop();
  const onResize = () => applyTop();
  window.addEventListener('resize', onResize);

  // ---- collapse to edge tab ----
  let collapsed = await collapsedStore.getValue();
  const applyCollapsed = () => {
    rail.style.display = collapsed ? 'none' : 'flex';
    tab.style.display = collapsed ? 'flex' : 'none';
    applyTop();
  };
  applyCollapsed();
  const setCollapsed = async (v: boolean) => {
    collapsed = v;
    applyCollapsed();
    await collapsedStore.setValue(v);
  };
  (rail.querySelector('.collapse') as HTMLButtonElement).onclick = () => setCollapsed(true);
  tab.onclick = () => setCollapsed(false);

  // ---- drag ----
  const grip = rail.querySelector('.grip') as HTMLElement;
  let dragging = false;
  grip.addEventListener('pointerdown', (e) => {
    dragging = true;
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const top = Math.max(8, Math.min(window.innerHeight - rail.offsetHeight - 8, e.clientY - rail.offsetHeight / 2));
    rail.style.top = `${top}px`;
  });
  grip.addEventListener('pointerup', async () => {
    if (!dragging) return;
    dragging = false;
    curY = Math.max(0, Math.min(1, (parseFloat(rail.style.top) + rail.offsetHeight / 2) / window.innerHeight));
    await setSettings({ quickBarY: curY });
  });

  // ---- actions ----
  const hideBtn = rail.querySelector('.hide') as HTMLButtonElement;
  const saveBtn = rail.querySelector('.btn.save') as HTMLButtonElement;
  const folderBtn = rail.querySelector('.btn.folder') as HTMLButtonElement;
  const dashBtn = rail.querySelector('.btn.dash') as HTMLButtonElement;

  // Hide the bar everywhere; re-enable from the popup → Settings (content.ts
  // watches this setting and unmounts/remounts live).
  hideBtn.onclick = () => setSettings({ enableQuickBar: false });

  let pop: HTMLDivElement | null = null;
  const closePop = () => {
    pop?.remove();
    pop = null;
  };
  const onDocClick = (e: MouseEvent) => {
    if (pop && !host.contains(e.target as Node)) closePop();
  };
  document.addEventListener('click', onDocClick);

  // ---- saved-state awareness ----
  const SAVE_ICON = icon('bookmark', true);
  let saved = false;
  const paintSave = (inner: string) => {
    saveBtn.innerHTML = inner;
    if (saved) {
      const b = document.createElement('span');
      b.className = 'badge';
      saveBtn.appendChild(b);
    }
  };
  const setSaved = (v: boolean) => {
    saved = v;
    saveBtn.title = v ? 'Already saved — click to save again' : 'Save this page';
    paintSave(SAVE_ICON);
  };

  async function loggedIn(): Promise<boolean> {
    try {
      return (await getBackend()).isLoggedIn();
    } catch {
      return false;
    }
  }

  async function quickSave(collection?: string) {
    if (!(await loggedIn())) {
      showSignIn();
      return;
    }
    saveBtn.innerHTML = `<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite"></span>`;
    try {
      await send({ type: 'SAVE_CURRENT_PAGE', collection });
    } catch {
      /* background queues on failure */
    }
    saveBtn.classList.add('ok');
    saveBtn.innerHTML = icon('check');
    setTimeout(() => {
      saveBtn.classList.remove('ok');
      setSaved(true);
    }, 1400);
  }

  function showSignIn() {
    closePop();
    pop = buildPop();
    pop.innerHTML = `<div class="msg">Sign in to Keepsake to save.<br><span class="link">Open Keepsake →</span></div>`;
    (pop.querySelector('.link') as HTMLElement).onclick = () => {
      send({ type: 'OPEN_DASHBOARD' });
      closePop();
    };
    shadow.appendChild(pop);
  }

  function buildPop(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'pop';
    const railRect = rail.getBoundingClientRect();
    el.style.right = `${window.innerWidth - railRect.left + 8}px`;
    el.style.top = `${Math.min(railRect.top, window.innerHeight - 320)}px`;
    return el;
  }

  async function openFolders() {
    if (!(await loggedIn())) {
      showSignIn();
      return;
    }
    closePop();
    pop = buildPop();
    pop.innerHTML = `<h4>Save to…</h4>`;
    shadow.appendChild(pop);

    const addRow = (label: string, color: string, collection?: string) => {
      const row = document.createElement('button');
      row.className = 'row';
      row.innerHTML = `<span class="dot" style="background:${color}"></span><span>${label}</span>`;
      row.onclick = () => {
        quickSave(collection);
        closePop();
      };
      pop!.appendChild(row);
    };

    addRow('Unsorted', 'rgba(255,255,255,.3)');
    try {
      const cols: Collection[] = await listCollections();
      for (const c of cols) addRow(`${c.icon ? c.icon + ' ' : ''}${c.name}`, c.color || accent, c.id);
    } catch {
      /* none */
    }

    // New-folder action: create a collection on the fly and save into it.
    const newRow = document.createElement('button');
    newRow.className = 'row';
    newRow.style.color = accent;
    newRow.innerHTML = `${icon('plus')}<span>New folder…</span>`;
    newRow.onclick = async () => {
      const nameInput = window.prompt('New folder name');
      const name = nameInput?.trim();
      if (!name) return;
      try {
        const created = await createCollection({ name });
        quickSave(created.id);
      } catch {
        /* ignore */
      }
      closePop();
    };
    pop!.appendChild(newRow);
  }

  saveBtn.onclick = () => quickSave();
  folderBtn.onclick = () => (pop ? closePop() : openFolders());
  dashBtn.onclick = () => send({ type: 'OPEN_DASHBOARD' });

  // spinner keyframes (scoped to shadow)
  const kf = document.createElement('style');
  kf.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
  shadow.appendChild(kf);

  // Reflect whether this page is already in the vault.
  if (await loggedIn()) {
    try {
      if (await findByUrl(location.href)) setSaved(true);
    } catch {
      /* ignore */
    }
  }

  const api: QuickBarApi = {
    openFolders,
    destroy: () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('click', onDocClick);
      host.remove();
    },
  };
  return api;
}
