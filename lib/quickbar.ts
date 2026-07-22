import { getSettings, setSettings } from './settings';
import { send, type SaveCurrentPageResult } from './messaging';
import { ACCENTS } from './theme';
import { clampQuickBarTop, quickBarFractionFromTop, quickBarSideForPointer } from './uiContext';
import { QUICKBAR_ICON_DEFAULT, QUICKBAR_WIDTH_DEFAULT, normalizeQuickBarColor, normalizeQuickBarIconSize, normalizeQuickBarOrder, normalizeQuickBarUrl, normalizeQuickBarWidth, rememberRecentCollection, reorderQuickBarAction, splitRecentCollections } from './quickbarConfig';
import { type Bookmark, type Collection, type QuickBarAction, type QuickBarCustomIcon, type QuickBarSide, type Settings } from './types';
import { type RecallItem, type RecallResult } from './recall';

// The in-page Quick Bar is rendered in a Shadow DOM so websites cannot restyle
// it. It snaps to either browser edge, remembers its position, and can collapse
// to a visible edge tab instead of disappearing.
export interface QuickBarApi {
  openFolders: () => void;
  refreshPage: () => void;
  update: (settings: Settings) => void;
  destroy: () => void;
}

type QuickBarHost = HTMLDivElement & { __keepsakeApi?: QuickBarApi };

interface QuickBarBootstrapResult {
  ok?: boolean;
  loggedIn: boolean;
  existing?: Bookmark | null;
  url: string;
  error?: string;
}

interface QuickBarCollectionsResult {
  ok?: boolean;
  collections?: Collection[];
  counts?: Record<string, number>;
  error?: string;
}

interface QuickBarSearchResult { ok?: boolean; items?: Bookmark[]; error?: string }
interface QuickBarCreateCollectionResult { ok?: boolean; collection?: Collection; error?: string }

const SVG = {
  grip: '<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>',
  bookmark: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  library: '<path d="M4 5h6v14H4zM10 5h5v14h-5zM17 5l3-.8 2 14.8-3 .8z"/><path d="M7 9h.01M12.5 9h.01M19 9h.01"/>',
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
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  sparkles: '<path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z"/>',
  related: '<path d="M8 6h11M5 6h.01M8 12h11M5 12h.01M8 18h11M5 18h.01"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/>',
};

function icon(name: keyof typeof SVG, fill = false, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[name]}</svg>`;
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
  button.style.pointerEvents = busy ? 'none' : '';
}

export async function mountQuickBar(initialSettings?: Settings): Promise<QuickBarApi | null> {
  const existing = document.getElementById('keepsake-quickbar') as QuickBarHost | null;
  if (existing?.__keepsakeApi) return existing.__keepsakeApi;
  existing?.remove();

  const settings = initialSettings ?? await getSettings();
  let currentSettings = settings;
  let railWidth = normalizeQuickBarWidth(settings.quickBarWidth);
  let actionIconSize = normalizeQuickBarIconSize(settings.quickBarIconSize);
  let accent = normalizeQuickBarColor(settings.quickBarColor) || ACCENTS.find((item) => item.key === settings.accent)?.swatch || '#2563eb';

  const host = document.createElement('div') as QuickBarHost;
  host.id = 'keepsake-quickbar';
  host.style.setProperty('--ks-accent', accent);
  host.style.setProperty('--ks-rail-width', `${railWidth}px`);
  host.style.setProperty('--ks-icon-size', `${actionIconSize}px`);
  const shadow = host.attachShadow({ mode: 'open' });
  (document.documentElement || document.body).appendChild(host);

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { font: inherit; }
    .rail { position: fixed; z-index: 2147483646; display: flex; flex-direction: column;
      align-items: center; gap: 3px; width: var(--ks-rail-width, 50px); padding: 7px 5px; color: #fff;
      background: linear-gradient(180deg, rgba(32,34,44,.96), rgba(18,20,27,.98));
      backdrop-filter: blur(12px) saturate(1.3); -webkit-backdrop-filter: blur(12px) saturate(1.3);
      border: 1px solid rgba(255,255,255,.12); box-shadow: 0 12px 34px rgba(0,0,0,.38),
      0 2px 8px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.07);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      opacity: .86; transition: opacity .16s, filter .16s, width .08s ease; }
    .rail.resizing { opacity: 1; transition: none; user-select: none; }
    .rail.right { right: 0; left: auto; border-right: none; border-radius: 16px 0 0 16px; }
    .rail.left { left: 0; right: auto; border-left: none; border-radius: 0 16px 16px 0; }
    .rail:hover, .rail.dragging { opacity: 1; filter: brightness(1.04); }
    .grip { width: 100%; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.55);
      cursor: grab; border-radius: 8px; touch-action: none; user-select: none; }
    .grip:hover { color: #fff; background: rgba(255,255,255,.1); }
    .grip:active { cursor: grabbing; }
    .mini { width: 100%; height: 22px; display: grid; place-items: center; color: rgba(255,255,255,.56);
      background: transparent; border: none; border-radius: 8px; cursor: pointer;
      transition: color .12s, background .12s; }
    .mini:hover { color: #fff; background: rgba(255,255,255,.12); }
    .hide { opacity: .65; }
    .rail:not(:hover) .hide { opacity: .25; }
    .btn { width: 100%; height: 38px; display: grid; place-items: center; color: rgba(255,255,255,.92);
      background: transparent; border: none; border-radius: 11px; cursor: pointer;
      transition: background .12s, transform .12s, color .12s, box-shadow .12s; }
    .btn:hover { background: rgba(255,255,255,.13); color: #fff; transform: scale(1.06); }
    .btn:active { transform: scale(.92); }
    .btn:disabled { opacity: .65; }
    button:focus-visible, input:focus-visible, select:focus-visible, [role="button"]:focus-visible { outline: 2px solid var(--ks-accent); outline-offset: 2px; }
    [data-tooltip] { position: relative; }
    [data-tooltip]::after { content: attr(data-tooltip); position: absolute; top: 50%; z-index: 2147483647;
      width: max-content; max-width: 220px; padding: 7px 9px; border: 1px solid rgba(255,255,255,.14);
      border-radius: 8px; background: rgba(15,17,23,.98); color: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.34);
      font: 600 11px/1.2 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; letter-spacing: .01em;
      white-space: nowrap; pointer-events: none; opacity: 0; visibility: hidden;
      transition: opacity .1s ease, transform .1s ease, visibility 0s linear .1s; transition-delay: 0s; }
    .rail.right [data-tooltip]::after, .tab.right[data-tooltip]::after { right: calc(100% + 10px); left: auto; transform: translate(6px,-50%); }
    .rail.left [data-tooltip]::after, .tab.left[data-tooltip]::after { left: calc(100% + 10px); right: auto; transform: translate(-6px,-50%); }
    [data-tooltip]:hover::after, [data-tooltip]:focus-visible::after { opacity: 1; visibility: visible;
      transform: translate(0,-50%); transition-delay: .08s; transition-property: opacity, transform, visibility; }
    .rail.dragging [data-tooltip]::after, .dragging-action::after { display: none; }
    .actions { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 3px; }
    .btn svg { width: var(--ks-icon-size, 20px); height: var(--ks-icon-size, 20px); max-width: calc(100% - 4px); max-height: calc(100% - 4px); }
    .mini svg, .grip svg { width: calc(var(--ks-icon-size, 20px) - 3px); height: calc(var(--ks-icon-size, 20px) - 3px); }
    .resize-handle { position: absolute; top: 14px; bottom: 14px; width: 8px; z-index: 3; cursor: ew-resize; touch-action: none; opacity: 0; transition: opacity .12s; }
    .resize-handle::after { content: ''; position: absolute; top: 35%; bottom: 35%; width: 2px; border-radius: 99px; background: rgba(255,255,255,.5); }
    .rail.right .resize-handle { left: -4px; }
    .rail.right .resize-handle::after { left: 3px; }
    .rail.left .resize-handle { right: -4px; }
    .rail.left .resize-handle::after { right: 3px; }
    .rail:hover .resize-handle, .rail.resizing .resize-handle, .resize-handle:focus-visible { opacity: .9; }
    .resize-handle:focus-visible { outline: 2px solid var(--ks-accent); outline-offset: 1px; }
    .action[draggable="true"] { cursor: grab; }
    .action.dragging-action { opacity: .42; transform: scale(.9); }
    .action.drop-target { outline: 2px solid var(--ks-accent); outline-offset: 2px; }
    .rail.compact { padding: 5px 4px; gap: 2px; border-radius: 13px 0 0 13px; }
    .rail.left.compact { border-radius: 0 13px 13px 0; }
    .rail.compact .btn { width: 100%; height: 32px; border-radius: 9px; }
    .rail.compact .mini, .rail.compact .grip { width: 100%; height: 19px; }
    .btn.save { position: relative; color: #fff; background: linear-gradient(135deg, var(--ks-accent), var(--ks-accent));
      box-shadow: 0 3px 12px var(--ks-accent); }
    .btn.save:hover { filter: brightness(1.12); }
    .btn.ok { color: #34d399; background: rgba(52,211,153,.16); box-shadow: none; }
    .badge { position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%;
      background: #34d399; box-shadow: 0 0 0 2px rgba(24,26,32,.94); }
    .count { position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; display: grid; place-items: center;
      padding: 0 4px; border-radius: 99px; background: #f59e0b; color: #111827; font-size: 9px; font-weight: 800;
      box-shadow: 0 0 0 2px rgba(24,26,32,.96); }
    .btn.related { position: relative; }
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
    .pop.wide { width: min(340px, calc(100vw - 76px)); }
    .section-title { margin: 8px 8px 3px; color: rgba(255,255,255,.42); font-size: 10px; font-weight: 750; text-transform: uppercase; letter-spacing: .06em; }
    .search-input { width: calc(100% - 8px); margin: 0 4px 7px; border: 1px solid rgba(255,255,255,.14); border-radius: 10px; background: rgba(255,255,255,.07); color: #fff; padding: 10px 11px; outline: none; font: 13px ui-sans-serif,system-ui; }
    .search-input:focus { border-color: var(--ks-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ks-accent) 25%, transparent); }
    .result { align-items: flex-start; padding: 9px 10px; }
    .result-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .result-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #fff; font-size: 12px; font-weight: 650; }
    .result-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255,255,255,.48); font-size: 10px; }
    .empty { padding: 18px 12px; color: rgba(255,255,255,.52); font-size: 12px; text-align: center; }
    .danger { color: #fca5a5; }
    .saved-card { margin: 4px; padding: 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 10px; background: rgba(255,255,255,.045); }
    .saved-title { margin: 0 0 4px; color: #fff; font-size: 12px; font-weight: 700; line-height: 1.35; }
    .saved-meta { margin: 0; color: rgba(255,255,255,.5); font-size: 10px; }
    .link { margin-top: 8px; display: inline-block; color: var(--ks-accent); cursor: pointer; text-decoration: underline; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinner { width: 17px; height: 17px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
      border-radius: 50%; animation: spin .6s linear infinite; }
  `;
  shadow.appendChild(style);

  const rail = document.createElement('div');
  rail.className = 'rail';
  rail.innerHTML = `
    <div class="resize-handle" role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="34" aria-valuemax="86" aria-label="Resize Quick Bar horizontally" data-tooltip="Drag to resize width"></div>
    <button class="mini hide" type="button" aria-label="Hide Quick Bar" data-tooltip="Hide Quick Bar">${icon('close')}</button>
    <button class="mini collapse" type="button" aria-label="Collapse Quick Bar" data-tooltip="Collapse Quick Bar"></button>
    <div class="grip" role="button" tabindex="0" aria-label="Drag Quick Bar" data-tooltip="Drag or move sides">${icon('grip')}</div>
    <div class="actions">
      <button class="btn action popup" draggable="true" data-action="popup" type="button" aria-label="Open Keepsake dropdown" data-tooltip="Open dropdown">${icon('popup')}</button>
      <button class="btn action search" draggable="true" data-action="search" type="button" aria-label="Search Keepsake" data-tooltip="Search Keepsake">${icon('search')}</button>
      <button class="btn action browse" draggable="true" data-action="browse" type="button" aria-label="Browse collections" data-tooltip="Browse collections">${icon('library')}</button>
      <button class="btn action ai" draggable="true" data-action="ai" type="button" aria-label="Open AI Writer" data-tooltip="AI Writer">${icon('sparkles')}</button>
      <button class="btn action related" draggable="true" data-action="related" type="button" aria-label="Related saves" data-tooltip="Related saves" hidden>${icon('related')}</button>
      <button class="btn action save" draggable="true" data-action="save" type="button" aria-label="Save this page" data-tooltip="Save page">${icon('bookmark', true)}</button>
      <button class="btn action folder" draggable="true" data-action="folder" type="button" aria-label="Save to collection" data-tooltip="Choose collection">${icon('folder')}</button>
      <button class="btn action dash" draggable="true" data-action="dashboard" type="button" aria-label="Open Keepsake dashboard" data-tooltip="Open dashboard">${icon('grid')}</button>
      <button class="btn action custom" draggable="true" data-action="custom" type="button" aria-label="Open custom shortcut" data-tooltip="Open shortcut" hidden>${icon('link')}</button>
    </div>
    <button class="mini customize" type="button" aria-label="Customize Quick Bar" data-tooltip="Customize Quick Bar">${icon('settings', false, 17)}</button>
  `;
  shadow.appendChild(rail);

  const tab = document.createElement('button');
  tab.className = 'tab';
  tab.type = 'button';
  tab.setAttribute('aria-label', 'Expand Keepsake Quick Bar');
  tab.dataset.tooltip = 'Expand Quick Bar';
  shadow.appendChild(tab);

  const resizeHandle = rail.querySelector('.resize-handle') as HTMLDivElement;
  const hideButton = rail.querySelector('.hide') as HTMLButtonElement;
  const collapseButton = rail.querySelector('.collapse') as HTMLButtonElement;
  const grip = rail.querySelector('.grip') as HTMLElement;
  const actions = rail.querySelector('.actions') as HTMLDivElement;
  const popupButton = rail.querySelector('.btn.popup') as HTMLButtonElement;
  const searchButton = rail.querySelector('.btn.search') as HTMLButtonElement;
  const browseButton = rail.querySelector('.btn.browse') as HTMLButtonElement;
  const aiButton = rail.querySelector('.btn.ai') as HTMLButtonElement;
  const relatedButton = rail.querySelector('.btn.related') as HTMLButtonElement;
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
  let resizing = false;
  let saving = false;
  let existingBookmark: Bookmark | null = null;
  let authenticated: boolean | null = null;
  let authCheckedAt = 0;
  let related: RecallItem[] = [];
  let collectionCache: { items: Collection[]; counts: Record<string, number>; at: number } | null = null;
  let searchSequence = 0;

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

  const applySizing = () => {
    railWidth = normalizeQuickBarWidth(railWidth);
    actionIconSize = normalizeQuickBarIconSize(actionIconSize);
    host.style.setProperty('--ks-rail-width', `${railWidth}px`);
    host.style.setProperty('--ks-icon-size', `${actionIconSize}px`);
    resizeHandle.setAttribute('aria-valuenow', String(railWidth));
    applyTop();
  };

  const applyAll = () => {
    applyEdge();
    applySizing();
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
      popup: popupButton, search: searchButton, browse: browseButton, ai: aiButton, related: relatedButton, save: saveButton, folder: folderButton, dashboard: dashboardButton, custom: customButton,
    };
    for (const action of order) actions.appendChild(map[action]);
    const customUrl = normalizeQuickBarUrl(currentSettings.quickBarCustomUrl);
    customButton.hidden = !customUrl;
    relatedButton.hidden = !currentSettings.recallEnabled || related.length === 0;
    relatedButton.innerHTML = `${icon('related')}<span class="count">${Math.min(99, related.length)}</span>`;
    relatedButton.dataset.tooltip = related.length ? `Related saves (${related.length})` : 'Related saves';
    const iconName = currentSettings.quickBarCustomIcon as QuickBarCustomIcon;
    customButton.innerHTML = icon(iconName in SVG ? iconName as keyof typeof SVG : 'link');
    customButton.dataset.tooltip = currentSettings.quickBarCustomLabel.trim() || 'Open shortcut';
    rail.classList.toggle('compact', currentSettings.quickBarSize === 'compact');
  };

  const updateFromSettings = (next: Settings) => {
    const recallChanged = next.recallEnabled !== currentSettings.recallEnabled;
    currentSettings = next;
    currentY = next.quickBarY;
    side = next.quickBarSide;
    collapsed = next.quickBarCollapsed;
    railWidth = normalizeQuickBarWidth(next.quickBarWidth);
    actionIconSize = normalizeQuickBarIconSize(next.quickBarIconSize);
    accent = normalizeQuickBarColor(next.quickBarColor) || ACCENTS.find((item) => item.key === next.accent)?.swatch || '#2563eb';
    host.style.setProperty('--ks-accent', accent);
    if (!next.recallEnabled) related = [];
    renderActions();
    applyAll();
    if (recallChanged && next.recallEnabled) window.setTimeout(() => loadRelated().catch(() => {}), 250);
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

  const finishResize = async () => {
    if (!resizing) return;
    resizing = false;
    rail.classList.remove('resizing');
    await setSettings({ quickBarWidth: railWidth });
  };

  resizeHandle.addEventListener('pointerdown', (event) => {
    resizing = true;
    rail.classList.add('resizing');
    resizeHandle.setPointerCapture(event.pointerId);
    closePopover();
    event.preventDefault();
    event.stopPropagation();
  });
  resizeHandle.addEventListener('pointermove', (event) => {
    if (!resizing) return;
    railWidth = normalizeQuickBarWidth(side === 'right' ? window.innerWidth - event.clientX : event.clientX);
    applySizing();
  });
  resizeHandle.addEventListener('pointerup', finishResize);
  resizeHandle.addEventListener('pointercancel', finishResize);
  resizeHandle.addEventListener('dblclick', async () => {
    railWidth = QUICKBAR_WIDTH_DEFAULT;
    applySizing();
    updateFromSettings(await setSettings({ quickBarWidth: railWidth }));
  });
  resizeHandle.addEventListener('keydown', (event) => {
    let next = railWidth;
    if (event.key === 'ArrowLeft') next -= side === 'right' ? 2 : -2;
    else if (event.key === 'ArrowRight') next += side === 'right' ? 2 : -2;
    else if (event.key === 'Home') next = 34;
    else if (event.key === 'End') next = 86;
    else return;
    event.preventDefault();
    railWidth = normalizeQuickBarWidth(next);
    applySizing();
  });
  resizeHandle.addEventListener('keyup', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    setSettings({ quickBarWidth: railWidth }).catch(() => {});
  });

  let draggedAction: QuickBarAction | null = null;
  for (const button of [popupButton, searchButton, browseButton, aiButton, relatedButton, saveButton, folderButton, dashboardButton, customButton]) {
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
    element.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 440))}px`;
    if (side === 'right') {
      element.style.right = `${Math.max(8, window.innerWidth - rect.left + 10)}px`;
      element.style.left = 'auto';
    } else {
      element.style.left = `${Math.max(8, rect.right + 10)}px`;
      element.style.right = 'auto';
    }
    return element;
  }

  function showMessage(message: string, actionLabel?: string, action?: () => void | Promise<void>) {
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
  }

  async function refreshBootstrap(): Promise<boolean> {
    const pageUrl = location.href;
    const response = await send<QuickBarBootstrapResult>({ type: 'KS_QUICKBAR_BOOTSTRAP', url: pageUrl }).catch(() => null);
    if (!response?.ok || response.url !== pageUrl || location.href !== pageUrl) return authenticated ?? false;
    authenticated = response.loggedIn;
    authCheckedAt = Date.now();
    existingBookmark = response.loggedIn ? response.existing ?? null : null;
    paintSave();
    return response.loggedIn;
  }

  async function loggedIn(): Promise<boolean> {
    const ttl = authenticated ? 30_000 : 3_000;
    if (authenticated != null && Date.now() - authCheckedAt < ttl) return authenticated;
    return refreshBootstrap();
  }

  const saveIcon = icon('bookmark', true);
  const paintSave = () => {
    saveButton.innerHTML = saveIcon;
    if (existingBookmark) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      saveButton.appendChild(badge);
    }
    saveButton.dataset.tooltip = existingBookmark ? 'Already saved — manage' : 'Save page';
  };

  const loadCollectionData = async (): Promise<{ items: Collection[]; counts: Record<string, number> }> => {
    if (collectionCache && Date.now() - collectionCache.at < 60_000) return collectionCache;
    const response = await send<QuickBarCollectionsResult>({ type: 'KS_QUICKBAR_COLLECTIONS' }).catch(() => null);
    if (!response?.ok) throw new Error(response?.error || 'Collections are unavailable.');
    collectionCache = { items: response.collections ?? [], counts: response.counts ?? {}, at: Date.now() };
    return collectionCache;
  };

  const loadCollections = async (): Promise<Collection[]> => (await loadCollectionData()).items;

  const searchVault = async (query: string, options: { collection?: string; unsorted?: boolean; perPage?: number } = {}) => {
    const response = await send<QuickBarSearchResult>({
      type: 'KS_QUICKBAR_SEARCH',
      query,
      collection: options.collection,
      unsorted: options.unsorted,
      perPage: options.perPage,
    }).catch(() => null);
    if (!response?.ok) throw new Error(response?.error || 'Search is unavailable.');
    return response.items ?? [];
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
    await refreshBootstrap();
  };

  async function quickSave(collection?: string, force = false, explicitCollection = false) {
    if (saving) return;
    if (existingBookmark && !force && collection === undefined) {
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
      const response = await send<SaveCurrentPageResult>({ type: 'SAVE_CURRENT_PAGE', collection, force, explicitCollection });
      if (!response?.ok && response?.status !== 'queued') throw new Error(response?.error || 'The page could not be saved');
      if (response.status === 'duplicate') {
        await refreshExisting();
        openDuplicateMenu();
        return;
      }
      if (response.status === 'queued') {
        authenticated = true;
        authCheckedAt = Date.now();
        paintSave();
        showMessage('Saved offline — Keepsake will sync it automatically when your connection returns.');
        return;
      }

      authenticated = true;
      authCheckedAt = Date.now();
      await rememberCollection(collection || response.collection);
      await refreshExisting();
      saveButton.classList.add('ok');
      saveButton.innerHTML = icon('check');
      const destination = await collectionLabel(response.collection || collection);
      showMessage(`Saved to ${destination}.`, response.id ? 'Undo' : undefined, response.id ? async () => {
        await send({ type: 'DELETE_BOOKMARK', id: response.id! });
        existingBookmark = null;
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
    if (!existingBookmark) return;
    const response = await send<{ ok?: boolean; bookmark?: Bookmark; error?: string }>({
      type: 'MOVE_BOOKMARK',
      id: existingBookmark.id,
      collection,
    }).catch(() => null);
    if (!response?.ok) {
      showMessage(response?.error || 'Keepsake could not move this save.');
      return;
    }
    existingBookmark = response.bookmark ?? { ...existingBookmark, collection };
    await rememberCollection(collection);
    paintSave();
    showMessage(`Moved to ${await collectionLabel(collection)}.`);
  }

  async function openFolders(moveMode = Boolean(existingBookmark)) {
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
        else quickSave(collection, false, true);
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
    newFolder.onclick = () => openCreateCollection(moveMode);
    popover.appendChild(newFolder);
  }

  function openCreateCollection(moveMode: boolean) {
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
        const response = await send<QuickBarCreateCollectionResult>({ type: 'KS_QUICKBAR_CREATE_COLLECTION', name }).catch(() => null);
        if (!response?.ok || !response.collection) throw new Error(response?.error || 'Collection creation failed.');
        collectionCache = null;
        if (moveMode) await moveExisting(response.collection.id);
        else await quickSave(response.collection.id, false, true);
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

  function addBookmarkRows(container: HTMLElement, items: (Bookmark | RecallItem)[], emptyMessage: string) {
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
    if (!existingBookmark) return;
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
    title.textContent = existingBookmark.title || existingBookmark.url;
    const meta = document.createElement('p');
    meta.className = 'saved-meta';
    meta.textContent = existingBookmark.collection ? 'Stored in a collection' : 'Stored in Unsorted';
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
        id: existingBookmark!.id,
        url: location.href,
      }).catch(() => null);
      if (!response?.ok) {
        showMessage(response?.error || 'Keepsake could not refresh this save.');
        return;
      }
      existingBookmark = response.bookmark ?? existingBookmark;
      paintSave();
      showMessage('Saved copy refreshed from the current page.');
    });
    addAction('Move to another collection…', () => openFolders(true));
    addAction('Save another copy', () => quickSave(undefined, true));
    addAction('Remove from Keepsake…', () => openDeleteConfirmation(), 'danger');
    shadow.appendChild(popover);
  }

  function openDeleteConfirmation() {
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

  async function openCollectionLauncher() {
    closePopover();
    popover = buildPopover();
    popover.classList.add('wide');
    const panel = popover;
    const heading = document.createElement('h4');
    heading.textContent = 'Browse collections';
    const list = document.createElement('div');
    list.innerHTML = '<div class="empty">Loading collections…</div>';
    popover.append(heading, list);
    shadow.appendChild(popover);

    const addCollectionRow = (label: string, color: string, count: number | undefined, id?: string, unsorted = false) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'row';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = color;
      const copy = document.createElement('span');
      copy.className = 'result-copy';
      const title = document.createElement('span');
      title.className = 'result-title';
      title.textContent = label;
      const meta = document.createElement('span');
      meta.className = 'result-meta';
      meta.textContent = count == null ? 'Open bookmarks' : String(count) + ' bookmark' + (count === 1 ? '' : 's');
      copy.append(title, meta);
      row.append(dot, copy);
      row.onclick = () => openCollectionBookmarks(id, label, unsorted);
      list.appendChild(row);
    };

    try {
      const { items: collections, counts } = await loadCollectionData();
      if (popover !== panel) return;
      list.replaceChildren();
      addCollectionRow('All bookmarks', accent, undefined);
      addCollectionRow('Unsorted', 'rgba(255,255,255,.35)', undefined, undefined, true);
      for (const collection of collections) {
        addCollectionRow(
          (collection.icon ? collection.icon + ' ' : '') + collection.name,
          collection.color || accent,
          counts[collection.id] || 0,
          collection.id,
        );
      }
      if (!collections.length) {
        const hint = document.createElement('div');
        hint.className = 'empty';
        hint.textContent = 'No collections yet — All bookmarks and Unsorted are still available.';
        list.appendChild(hint);
      }
    } catch {
      if (popover !== panel) return;
      list.innerHTML = '<div class="empty">Collections could not be loaded. Try again.</div>';
    }
  }

  async function openCollectionBookmarks(collectionId: string | undefined, label: string, unsorted = false) {
    closePopover();
    popover = buildPopover();
    popover.classList.add('wide');
    const panel = popover;

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'row';
    back.textContent = '← All collections';
    back.onclick = openCollectionLauncher;
    const heading = document.createElement('h4');
    heading.textContent = label;
    const input = document.createElement('input');
    input.className = 'search-input';
    input.type = 'search';
    input.placeholder = 'Search ' + label.toLowerCase() + '…';
    const results = document.createElement('div');
    popover.append(back, heading, input, results);
    shadow.appendChild(popover);

    let timer: number | undefined;
    let sequence = 0;
    const run = async () => {
      const current = ++sequence;
      const query = input.value.trim();
      results.innerHTML = '<div class="empty">Loading bookmarks…</div>';
      let items: Bookmark[];
      try {
        items = await searchVault(query, { collection: collectionId, unsorted, perPage: unsorted ? 300 : 50 });
      } catch {
        if (popover === panel && current === sequence) results.innerHTML = '<div class="empty">Bookmarks could not be loaded. Try again.</div>';
        return;
      }
      if (popover !== panel || current !== sequence) return;
      addBookmarkRows(results, items, query ? 'No matching bookmarks.' : 'This collection is empty.');
      if (items.length) {
        const dashboard = document.createElement('button');
        dashboard.type = 'button';
        dashboard.className = 'row';
        dashboard.textContent = 'Open full dashboard →';
        dashboard.onclick = () => send({ type: 'OPEN_DASHBOARD' });
        results.appendChild(dashboard);
      }
    };
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 140);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') (results.querySelector('button') as HTMLButtonElement | null)?.click();
    });
    await run();
    input.focus();
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

    const panel = popover;
    let timer: number | undefined;
    const run = async () => {
      const sequence = ++searchSequence;
      const query = input.value.trim();
      results.innerHTML = '<div class="empty">Searching…</div>';
      let items: Bookmark[];
      try {
        items = await searchVault(query, { perPage: 8 });
      } catch {
        if (sequence === searchSequence && popover === panel) results.innerHTML = '<div class="empty">Search is unavailable. Try again.</div>';
        return;
      }
      if (sequence !== searchSequence || popover !== panel) return;
      addBookmarkRows(results, items, query ? 'No matching saves.' : 'Your library is empty.');
    };
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, 200);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') (results.querySelector('button') as HTMLButtonElement | null)?.click();
    });
    await run();
    input.focus();
  }

  async function loadRelated() {
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
    hint.textContent = 'Drag actions to reorder. Drag the dock’s inner edge to resize it horizontally.';
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

    const widthLabel = document.createElement('label');
    const widthText = document.createElement('span');
    widthText.textContent = `Dock width — ${railWidth}px`;
    const widthInput = document.createElement('input');
    widthInput.type = 'range';
    widthInput.min = '34';
    widthInput.max = '86';
    widthInput.step = '1';
    widthInput.value = String(railWidth);
    widthInput.oninput = () => {
      railWidth = normalizeQuickBarWidth(widthInput.value);
      widthText.textContent = `Dock width — ${railWidth}px`;
      applySizing();
    };
    widthInput.onchange = async () => updateFromSettings(await setSettings({ quickBarWidth: railWidth }));
    widthLabel.append(widthText, widthInput);
    form.appendChild(widthLabel);

    const iconLabel = document.createElement('label');
    const iconText = document.createElement('span');
    iconText.textContent = `Icon size — ${actionIconSize}px`;
    const iconInput = document.createElement('input');
    iconInput.type = 'range';
    iconInput.min = '14';
    iconInput.max = '26';
    iconInput.step = '1';
    iconInput.value = String(actionIconSize);
    iconInput.oninput = () => {
      actionIconSize = normalizeQuickBarIconSize(iconInput.value);
      iconText.textContent = `Icon size — ${actionIconSize}px`;
      applySizing();
    };
    iconInput.onchange = async () => updateFromSettings(await setSettings({ quickBarIconSize: actionIconSize }));
    iconLabel.append(iconText, iconInput);
    form.appendChild(iconLabel);

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
      updateFromSettings(await setSettings({ quickBarOrder: ['popup', 'search', 'browse', 'ai', 'related', 'save', 'folder', 'dashboard', 'custom'] }));
      openCustomize();
    };
    const resetSize = document.createElement('button');
    resetSize.type = 'button';
    resetSize.className = 'chip';
    resetSize.textContent = 'Reset size';
    resetSize.onclick = async () => {
      updateFromSettings(await setSettings({ quickBarWidth: QUICKBAR_WIDTH_DEFAULT, quickBarIconSize: QUICKBAR_ICON_DEFAULT }));
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
    buttons.append(reset, resetSize, save);
    form.appendChild(buttons);
    popover.appendChild(form);
    shadow.appendChild(popover);
  }

  popupButton.onclick = openDropdown;
  searchButton.onclick = openSearch;
  browseButton.onclick = openCollectionLauncher;
  aiButton.onclick = async () => {
    const response = await send<{ ok?: boolean; error?: string }>({ type: 'OPEN_AI_TOOLS' }).catch(() => null);
    if (!response?.ok) showMessage(response?.error || 'Keepsake could not open AI Writer.');
  };
  relatedButton.onclick = openRelated;
  saveButton.onclick = () => quickSave();
  folderButton.onclick = () => openFolders(Boolean(existingBookmark));
  dashboardButton.onclick = () => send({ type: 'OPEN_DASHBOARD' });
  customButton.onclick = openCustomShortcut;
  customizeButton.onclick = openCustomize;

  const hydratePageState = async () => {
    const pageUrl = location.href;
    const yes = await refreshBootstrap();
    if (!yes || destroyed || location.href !== pageUrl) return;
    if (currentSettings.recallEnabled) window.setTimeout(() => loadRelated().catch(() => {}), 450);
  };

  const refreshPage = () => {
    closePopover();
    existingBookmark = null;
    related = [];
    searchSequence++;
    paintSave();
    renderActions();
    window.setTimeout(() => hydratePageState().catch(() => {}), 0);
  };

  // Paint immediately. Auth, duplicate lookup, and Recall hydrate after the
  // dock is already interactive so a slow cloud backend never delays the UI.
  paintSave();
  window.setTimeout(() => hydratePageState().catch(() => {}), 0);

  const api: QuickBarApi = {
    openFolders,
    refreshPage,
    update: updateFromSettings,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      closePopover();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeydown, true);
      host.remove();
      host.__keepsakeApi = undefined;
    },
  };

  host.__keepsakeApi = api;
  return api;
}
