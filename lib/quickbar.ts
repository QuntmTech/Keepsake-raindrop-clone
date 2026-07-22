import { getSettings, setSettings } from './settings';
import { getBackend } from './backend';
import { listCollections, createCollection, findByUrl } from './bookmarks';
import { send } from './messaging';
import { ACCENTS } from './theme';
import { clampQuickBarTop, quickBarFractionFromTop, quickBarSideForPointer } from './uiContext';
import { normalizeQuickBarColor, normalizeQuickBarOrder, normalizeQuickBarUrl, reorderQuickBarAction } from './quickbarConfig';
import { type Collection, type QuickBarAction, type QuickBarCustomIcon, type QuickBarSide, type Settings } from './types';

// The in-page Quick Bar is rendered in a Shadow DOM so websites cannot restyle
// it. It snaps to either browser edge, remembers its position, and can collapse
// to a visible edge tab instead of disappearing.
export interface QuickBarApi {
  openFolders: () => void;
  update: (settings: Settings) => void;
  destroy: () => void;
}

type QuickBarHost = HTMLDivElement & { __keepsakeApi?: QuickBarApi };

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
  popup: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16M8 7h.01M11 7h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20h-3v-.08a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 6.6 15a1.7 1.7 0 0 0-1.56-1.04H5v-3h.08A1.7 1.7 0 0 0 6.64 9.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.34 4.7V4h3v.08a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.04H21v3h-.08A1.7 1.7 0 0 0 19.4 15z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20.07l1.15-1.15"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
};

function icon(name: keyof typeof SVG, fill = false, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name]}</svg>`;
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
  button.style.pointerEvents = busy ? 'none' : '';
}

export async function mountQuickBar(): Promise<QuickBarApi | null> {
  const existing = document.getElementById('keepsake-quickbar') as QuickBarHost | null;
  if (existing?.__keepsakeApi) return existing.__keepsakeApi;
  existing?.remove();

  const settings = await getSettings();
  let currentSettings = settings;
  let accent = normalizeQuickBarColor(settings.quickBarColor) || ACCENTS.find((item) => item.key === settings.accent)?.swatch || '#2563eb';

  const host = document.createElement('div') as QuickBarHost;
  host.id = 'keepsake-quickbar';
  host.style.setProperty('--ks-accent', accent);
  const shadow = host.attachShadow({ mode: 'open' });
  (document.documentElement || document.body).appendChild(host);

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { font: inherit; }
    .rail { position: fixed; z-index: 2147483646; display: flex; flex-direction: column;
      align-items: center; gap: 3px; padding: 7px 5px; color: #fff;
      background: linear-gradient(180deg, rgba(32,34,44,.96), rgba(18,20,27,.98));
      backdrop-filter: blur(12px) saturate(1.3); -webkit-backdrop-filter: blur(12px) saturate(1.3);
      border: 1px solid rgba(255,255,255,.12); box-shadow: 0 12px 34px rgba(0,0,0,.38),
      0 2px 8px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.07);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: .86; transition: opacity .16s, filter .16s; }
    .rail.right { right: 0; left: auto; border-right: none; border-radius: 16px 0 0 16px; }
    .rail.left { left: 0; right: auto; border-left: none; border-radius: 0 16px 16px 0; }
    .rail:hover, .rail.dragging { opacity: 1; filter: brightness(1.04); }
    .grip { width: 38px; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.55);
      cursor: grab; border-radius: 8px; touch-action: none; user-select: none; }
    .grip:hover { color: #fff; background: rgba(255,255,255,.1); }
    .grip:active { cursor: grabbing; }
    .mini { width: 38px; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.56);
      background: transparent; border: none; border-radius: 8px; cursor: pointer;
      transition: color .12s, background .12s; }
    .mini:hover { color: #fff; background: rgba(255,255,255,.12); }
    .hide { opacity: .65; }
    .rail:not(:hover) .hide { opacity: .25; }
    .btn { width: 38px; height: 38px; display: grid; place-items: center; color: rgba(255,255,255,.92);
      background: transparent; border: none; border-radius: 11px; cursor: pointer;
      transition: background .12s, transform .12s, color .12s, box-shadow .12s; }
    .btn:hover { background: rgba(255,255,255,.13); color: #fff; transform: scale(1.06); }
    .btn:active { transform: scale(.92); }
    .btn:disabled { opacity: .65; }
    .actions { display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .action[draggable="true"] { cursor: grab; }
    .action.dragging-action { opacity: .42; transform: scale(.9); }
    .action.drop-target { outline: 2px solid var(--ks-accent); outline-offset: 2px; }
    .rail.compact { padding: 5px 4px; gap: 2px; border-radius: 13px 0 0 13px; }
    .rail.left.compact { border-radius: 0 13px 13px 0; }
    .rail.compact .btn { width: 32px; height: 32px; border-radius: 9px; }
    .rail.compact .mini, .rail.compact .grip { width: 32px; height: 19px; }
    .btn.save { position: relative; color: #fff; background: linear-gradient(135deg, var(--ks-accent), var(--ks-accent));
      box-shadow: 0 3px 12px var(--ks-accent); }
    .btn.save:hover { filter: brightness(1.12); }
    .btn.ok { color: #34d399; background: rgba(52,211,153,.16); box-shadow: none; }
    .badge { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%;
      background: #34d399; box-shadow: 0 0 0 2px rgba(24,26,32,.94); }
    .tab { position: fixed; z-index: 2147483646; display: none; align-items: center; justify-content: center;
      gap: 1px; width: 25px; height: 64px; padding: 0; border: 1px solid rgba(255,255,255,.12);
      cursor: pointer; color: #fff; background: rgba(24,26,32,.96); backdrop-filter: blur(8px);
      box-shadow: 0 8px 26px rgba(0,0,0,.34); opacity: .78; overflow: hidden;
      transition: width .15s, opacity .15s, background .15s; }
    .tab.right { right: 0; left: auto; border-right: none; border-radius: 11px 0 0 11px; }
    .tab.left { left: 0; right: auto; border-left: none; border-radius: 0 11px 11px 0; }
    .tab:hover { width: 42px; opacity: 1; background: rgba(24,26,32,.99); }
    .tabmark { color: var(--ks-accent); display: grid; place-items: center; }
    .tabchev { display: none; color: rgba(255,255,255,.75); }
    .tab:hover .tabchev { display: grid; place-items: center; }
    .pop { position: fixed; z-index: 2147483647; width: min(250px, calc(100vw - 76px)); max-height: min(60vh, 430px);
      overflow: auto; background: #1b1d24; color: #eef; border: 1px solid rgba(255,255,255,.1);
      border-radius: 13px; box-shadow: 0 12px 34px rgba(0,0,0,.45); padding: 8px;
      font-family: ui-sans-serif, system-ui, sans-serif; }
    .pop h4 { margin: 4px 8px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em;
      color: rgba(255,255,255,.48); font-weight: 650; }
    .row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 10px;
      background: transparent; border: none; border-radius: 8px; cursor: pointer; color: #eef;
      font-size: 13px; text-align: left; }
    .row:hover { background: rgba(255,255,255,.09); }
    .row svg { width: 16px; height: 16px; flex: none; }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .msg { padding: 14px 12px; font-size: 13px; line-height: 1.45; color: rgba(255,255,255,.76); text-align: center; }
    .config { display: flex; flex-direction: column; gap: 10px; padding: 5px; }
    .config label { display: flex; flex-direction: column; gap: 5px; color: rgba(255,255,255,.72); font-size: 11px; font-weight: 650; }
    .config input, .config select { width: 100%; border: 1px solid rgba(255,255,255,.13); border-radius: 8px; background: rgba(255,255,255,.07); color: #fff; padding: 8px; font: 12px ui-sans-serif,system-ui; outline: none; }
    .config select option { color: #111; }
    .config-actions, .chips { display: flex; gap: 6px; flex-wrap: wrap; }
    .chip { flex: 1; min-width: 82px; border: 1px solid rgba(255,255,255,.13); border-radius: 8px; background: rgba(255,255,255,.07); color: #fff; padding: 7px 8px; cursor: pointer; font-size: 11px; }
    .chip.active { border-color: var(--ks-accent); box-shadow: inset 0 0 0 1px var(--ks-accent); }
    .swatch { width: 25px; height: 25px; border-radius: 50%; border: 2px solid rgba(255,255,255,.45); cursor: pointer; padding: 0; }
    .hint { margin: 0; color: rgba(255,255,255,.48); font-size: 10px; line-height: 1.4; }
    .primary-small { border: none; border-radius: 8px; background: var(--ks-accent); color: #fff; padding: 8px 10px; cursor: pointer; font-size: 11px; font-weight: 700; }
    .link { margin-top: 8px; display: inline-block; color: var(--ks-accent); cursor: pointer; text-decoration: underline; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { width: 17px; height: 17px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
      border-radius: 50%; animation: spin .6s linear infinite; }
  `;
  shadow.appendChild(style);

  const rail = document.createElement('div');
  rail.className = 'rail';
  rail.innerHTML = `
    <button class="mini hide" type="button" aria-label="Hide Quick Bar" title="Hide Quick Bar — turn it back on in Keepsake Settings">${icon('close')}</button>
    <button class="mini collapse" type="button" aria-label="Collapse Quick Bar" title="Collapse to the browser edge"></button>
    <div class="grip" role="button" aria-label="Drag Quick Bar" title="Drag up/down or across the screen to switch sides">${icon('grip')}</div>
    <div class="actions">
      <button class="btn action popup" draggable="true" data-action="popup" type="button" aria-label="Open Keepsake dropdown" title="Open Keepsake dropdown">${icon('popup')}</button>
      <button class="btn action save" draggable="true" data-action="save" type="button" aria-label="Save this page" title="Save this page">${icon('bookmark', true)}</button>
      <button class="btn action folder" draggable="true" data-action="folder" type="button" aria-label="Save to collection" title="Save to collection">${icon('folder')}</button>
      <button class="btn action dash" draggable="true" data-action="dashboard" type="button" aria-label="Open Keepsake dashboard" title="Open Keepsake dashboard">${icon('grid')}</button>
      <button class="btn action custom" draggable="true" data-action="custom" type="button" aria-label="Open custom shortcut" title="Open custom shortcut" hidden>${icon('link')}</button>
    </div>
    <button class="mini customize" type="button" aria-label="Customize Quick Bar" title="Customize Quick Bar">${icon('settings', false, 17)}</button>
  `;
  shadow.appendChild(rail);

  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.type = 'button';
  tab.title = 'Expand Keepsake Quick Bar';
  shadow.appendChild(tab);

  const hideButton = rail.querySelector('.hide') as HTMLButtonElement;
  const collapseButton = rail.querySelector('.collapse') as HTMLButtonElement;
  const grip = rail.querySelector('.grip') as HTMLElement;
  const actions = rail.querySelector('.actions') as HTMLDivElement;
  const popupButton = rail.querySelector('.btn.popup') as HTMLButtonElement;
  const saveButton = rail.querySelector('.btn.save') as HTMLButtonElement;
  const folderButton = rail.querySelector('.btn.folder') as HTMLButtonElement;
  const dashboardButton = rail.querySelector('.btn.dash') as HTMLButtonElement;
  const customButton = rail.querySelector('.btn.custom') as HTMLButtonElement;
  const customizeButton = rail.querySelector('.customize') as HTMLButtonElement;

  let currentY = settings.quickBarY;
  let side: QuickBarSide = settings.quickBarSide;
  let collapsed = settings.quickBarCollapsed;
  let popover: HTMLDivElement | null = null;
  let destroyed = false;
  let dragging = false;
  let saving = false;
  let saved = false;

  const closePopover = () => {
    popover?.remove();
    popover = null;
  };

  const paintDirection = () => {
    collapseButton.innerHTML = icon(side === 'right' ? 'chevronR' : 'chevronL');
    const inward = side === 'right' ? 'chevronL' : 'chevronR';
    tab.innerHTML = `<span class="tabmark">${icon('bookmark', true, 16)}</span><span class="tabchev">${icon(inward, false, 15)}</span>`;
  };

  const applyEdge = () => {
    rail.classList.toggle('left', side === 'left');
    rail.classList.toggle('right', side === 'right');
    tab.classList.toggle('left', side === 'left');
    tab.classList.toggle('right', side === 'right');
    paintDirection();
  };

  const applyTop = () => {
    const railHeight = rail.offsetHeight || 178;
    rail.style.top = `${clampQuickBarTop(currentY, window.innerHeight, railHeight)}px`;
    tab.style.top = `${clampQuickBarTop(currentY, window.innerHeight, tab.offsetHeight || 64)}px`;
  };

  const applyCollapsed = () => {
    rail.style.display = collapsed ? 'none' : 'flex';
    tab.style.display = collapsed ? 'flex' : 'none';
    applyTop();
  };

  const applyAll = () => {
    applyEdge();
    applyCollapsed();
  };

  const setCollapsed = async (value: boolean) => {
    collapsed = value;
    applyCollapsed();
    await setSettings({ quickBarCollapsed: value });
  };

  const renderActions = () => {
    const order = normalizeQuickBarOrder(currentSettings.quickBarOrder);
    const map: Record<QuickBarAction, HTMLButtonElement> = {
      popup: popupButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,
    };
    for (const action of order) actions.appendChild(map[action]);
    const customUrl = normalizeQuickBarUrl(currentSettings.quickBarCustomUrl);
    customButton.hidden = !customUrl;
    const iconName = currentSettings.quickBarCustomIcon as QuickBarCustomIcon;
    customButton.innerHTML = icon(iconName in SVG ? iconName as keyof typeof SVG : 'link');
    customButton.title = currentSettings.quickBarCustomLabel.trim() || 'Open custom shortcut';
    rail.classList.toggle('compact', currentSettings.quickBarSize === 'compact');
  };

  const updateFromSettings = (next: Settings) => {
    currentSettings = next;
    currentY = next.quickBarY;
    side = next.quickBarSide;
    collapsed = next.quickBarCollapsed;
    accent = normalizeQuickBarColor(next.quickBarColor) || ACCENTS.find((item) => item.key === next.accent)?.swatch || '#2563eb';
    host.style.setProperty('--ks-accent', accent);
    renderActions();
    applyAll();
  };

  renderActions();
  applyAll();

  const onResize = () => {
    applyTop();
    closePopover();
  };
  window.addEventListener('resize', onResize);

  collapseButton.onclick = () => setCollapsed(true);
  tab.onclick = () => setCollapsed(false);
  hideButton.onclick = () => setSettings({ enableQuickBar: false });

  const finishDrag = async () => {
    if (!dragging) return;
    dragging = false;
    rail.classList.remove('dragging');
    currentY = quickBarFractionFromTop(parseFloat(rail.style.top) || 0, window.innerHeight, rail.offsetHeight || 178);
    await setSettings({ quickBarY: currentY, quickBarSide: side, quickBarCollapsed: false });
  };

  grip.addEventListener('pointerdown', (event) => {
    dragging = true;
    rail.classList.add('dragging');
    grip.setPointerCapture(event.pointerId);
    closePopover();
    event.preventDefault();
  });

  grip.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const nextSide = quickBarSideForPointer(event.clientX, window.innerWidth);
    if (nextSide !== side) {
      side = nextSide;
      applyEdge();
    }
    const center = Math.max(0, Math.min(1, event.clientY / Math.max(1, window.innerHeight)));
    rail.style.top = `${clampQuickBarTop(center, window.innerHeight, rail.offsetHeight || 178)}px`;
  });

  grip.addEventListener('pointerup', finishDrag);
  grip.addEventListener('pointercancel', finishDrag);

  let draggedAction: QuickBarAction | null = null;
  for (const button of [popupButton, saveButton, folderButton, dashboardButton, customButton]) {
    button.addEventListener('dragstart', (event) => {
      draggedAction = button.dataset.action as QuickBarAction;
      button.classList.add('dragging-action');
      event.dataTransfer?.setData('text/plain', draggedAction);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    button.addEventListener('dragend', () => {
      draggedAction = null;
      button.classList.remove('dragging-action');
      for (const item of actions.querySelectorAll('.drop-target')) item.classList.remove('drop-target');
    });
    button.addEventListener('dragover', (event) => {
      if (!draggedAction) return;
      event.preventDefault();
      button.classList.add('drop-target');
    });
    button.addEventListener('dragleave', () => button.classList.remove('drop-target'));
    button.addEventListener('drop', async (event) => {
      event.preventDefault();
      button.classList.remove('drop-target');
      const target = button.dataset.action as QuickBarAction;
      const source = draggedAction || event.dataTransfer?.getData('text/plain') as QuickBarAction;
      if (!source || source === target) return;
      const nextOrder = reorderQuickBarAction(currentSettings.quickBarOrder, source, target);
      updateFromSettings(await setSettings({ quickBarOrder: nextOrder }));
    });
  }

  const onDocumentClick = (event: MouseEvent) => {
    if (popover && !host.contains(event.target as Node)) closePopover();
  };
  document.addEventListener('click', onDocumentClick);

  function buildPopover(): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'pop';
    const rect = (collapsed ? tab : rail).getBoundingClientRect();
    element.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 330))}px`;
    if (side === 'right') {
      element.style.right = `${Math.max(8, window.innerWidth - rect.left + 10)}px`;
      element.style.left = 'auto';
    } else {
      element.style.left = `${Math.max(8, rect.right + 10)}px`;
      element.style.right = 'auto';
    }
    return element;
  }

  function showMessage(message: string, actionLabel?: string, action?: () => void) {
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
  }

  async function loggedIn(): Promise<boolean> {
    try {
      return (await getBackend()).isLoggedIn();
    } catch {
      return false;
    }
  }

  const saveIcon = icon('bookmark', true);
  const paintSave = () => {
    saveButton.innerHTML = saveIcon;
    if (saved) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      saveButton.appendChild(badge);
    }
    saveButton.title = saved ? 'Already saved — click to save another copy' : 'Save this page';
  };

  async function quickSave(collection?: string) {
    if (saving) return;
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
      const response = await send<{ ok?: boolean; error?: string }>({ type: 'SAVE_CURRENT_PAGE', collection });
      if (!response?.ok) throw new Error(response?.error || 'The page could not be saved');
      saved = true;
      saveButton.classList.add('ok');
      saveButton.innerHTML = icon('check');
      closePopover();
      setTimeout(() => {
        saveButton.classList.remove('ok');
        paintSave();
      }, 1100);
    } catch (error) {
      saved = false;
      paintSave();
      showMessage((error as Error)?.message || 'Keepsake could not save this page. Try again.');
    } finally {
      saving = false;
      setButtonBusy(saveButton, false);
      setButtonBusy(folderButton, false);
    }
  }

  async function openFolders() {
    if (!(await loggedIn())) {
      showMessage('Sign in to Keepsake before saving.', 'Open Keepsake →', () => {
        send({ type: 'OPEN_DASHBOARD' });
        closePopover();
      });
      return;
    }

    closePopover();
    popover = buildPopover();
    const heading = document.createElement('h4');
    heading.textContent = 'Save to…';
    popover.appendChild(heading);
    shadow.appendChild(popover);

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
        quickSave(collection);
        closePopover();
      };
      popover.appendChild(row);
    };

    addRow('Unsorted', 'rgba(255,255,255,.35)');
    try {
      const collections: Collection[] = await listCollections();
      for (const collection of collections) {
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
    label.textContent = 'New folder…';
    newFolder.appendChild(label);
    newFolder.onclick = async () => {
      const name = window.prompt('New folder name')?.trim();
      if (!name) return;
      try {
        const created = await createCollection({ name });
        await quickSave(created.id);
      } catch {
        showMessage('The folder could not be created. Try again.');
      }
      closePopover();
    };
    popover.appendChild(newFolder);
  }

  async function openDropdown() {
    try {
      const response = await send<{ ok?: boolean; error?: string }>({ type: 'OPEN_POPUP' });
      if (!response?.ok) throw new Error(response?.error || 'The dropdown could not be opened');
    } catch (error) {
      showMessage((error as Error)?.message || 'Keepsake could not open the dropdown.');
    }
  }

  async function openCustomShortcut() {
    const url = normalizeQuickBarUrl(currentSettings.quickBarCustomUrl);
    if (!url) {
      showMessage('Add a valid custom URL in Quick Bar settings first.');
      return;
    }
    const response = await send<{ ok?: boolean; error?: string }>({ type: 'OPEN_URL', url }).catch(() => null);
    if (!response?.ok) showMessage(response?.error || 'The custom shortcut could not be opened.');
  }

  function openCustomize() {
    closePopover();
    popover = buildPopover();
    const heading = document.createElement('h4');
    heading.textContent = 'Customize Quick Bar';
    popover.appendChild(heading);
    const form = document.createElement('div');
    form.className = 'config';

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Drag the four action buttons directly on the dock to reorder them.';
    form.appendChild(hint);

    const sizeWrap = document.createElement('div');
    sizeWrap.className = 'chips';
    for (const size of ['compact', 'comfortable'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `chip ${currentSettings.quickBarSize === size ? 'active' : ''}`;
      button.textContent = size === 'compact' ? 'Compact' : 'Comfortable';
      button.onclick = async () => {
        updateFromSettings(await setSettings({ quickBarSize: size }));
        openCustomize();
      };
      sizeWrap.appendChild(button);
    }
    form.appendChild(sizeWrap);

    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Dock color';
    const colors = document.createElement('div');
    colors.className = 'chips';
    const palette = ['', '#2563eb', '#7c3aed', '#059669', '#e11d48', '#ea580c', '#111827'];
    for (const color of palette) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.title = color || 'Follow app accent';
      swatch.style.background = color || ACCENTS.find((item) => item.key === currentSettings.accent)?.swatch || '#2563eb';
      swatch.onclick = async () => {
        updateFromSettings(await setSettings({ quickBarColor: color }));
        openCustomize();
      };
      colors.appendChild(swatch);
    }
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = normalizeQuickBarColor(currentSettings.quickBarColor) || accent;
    picker.title = 'Choose any color';
    picker.style.width = '38px';
    picker.style.padding = '2px';
    picker.onchange = async () => updateFromSettings(await setSettings({ quickBarColor: picker.value }));
    colors.appendChild(picker);
    colorLabel.appendChild(colors);
    form.appendChild(colorLabel);

    const urlLabel = document.createElement('label');
    urlLabel.textContent = 'Custom shortcut URL (optional)';
    const urlInput = document.createElement('input');
    urlInput.placeholder = 'example.com or https://example.com';
    urlInput.value = currentSettings.quickBarCustomUrl;
    urlLabel.appendChild(urlInput);
    form.appendChild(urlLabel);

    const labelWrap = document.createElement('label');
    labelWrap.textContent = 'Shortcut name';
    const labelInput = document.createElement('input');
    labelInput.maxLength = 40;
    labelInput.value = currentSettings.quickBarCustomLabel;
    labelWrap.appendChild(labelInput);
    form.appendChild(labelWrap);

    const iconWrap = document.createElement('label');
    iconWrap.textContent = 'Shortcut icon';
    const iconSelect = document.createElement('select');
    for (const name of ['link', 'globe', 'bolt', 'star'] as QuickBarCustomIcon[]) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name[0].toUpperCase() + name.slice(1);
      option.selected = currentSettings.quickBarCustomIcon === name;
      iconSelect.appendChild(option);
    }
    iconWrap.appendChild(iconSelect);
    form.appendChild(iconWrap);

    const buttons = document.createElement('div');
    buttons.className = 'config-actions';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'chip';
    reset.textContent = 'Reset order';
    reset.onclick = async () => {
      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'save', 'folder', 'dashboard', 'custom'] }));
      openCustomize();
    };
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'primary-small';
    save.textContent = 'Save customization';
    save.onclick = async () => {
      const entered = urlInput.value.trim();
      const normalized = normalizeQuickBarUrl(entered);
      if (entered && !normalized) {
        showMessage('That shortcut URL is not valid. Use an http:// or https:// address.');
        return;
      }
      updateFromSettings(await setSettings({
        quickBarCustomUrl: normalized,
        quickBarCustomLabel: labelInput.value.trim() || 'Open shortcut',
        quickBarCustomIcon: iconSelect.value as QuickBarCustomIcon,
      }));
      closePopover();
    };
    buttons.append(reset, save);
    form.appendChild(buttons);
    popover.appendChild(form);
    shadow.appendChild(popover);
  }

  popupButton.onclick = openDropdown;
  saveButton.onclick = () => quickSave();
  folderButton.onclick = () => (popover ? closePopover() : openFolders());
  dashboardButton.onclick = () => send({ type: 'OPEN_DASHBOARD' });
  customButton.onclick = openCustomShortcut;
  customizeButton.onclick = () => (popover ? closePopover() : openCustomize());

  if (await loggedIn()) {
    try {
      saved = Boolean(await findByUrl(location.href));
      paintSave();
    } catch {
      paintSave();
    }
  } else {
    paintSave();
  }

  const api: QuickBarApi = {
    openFolders,
    update: updateFromSettings,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      closePopover();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('click', onDocumentClick);
      host.remove();
      host.__keepsakeApi = undefined;
    },
  };

  host.__keepsakeApi = api;
  return api;
}
