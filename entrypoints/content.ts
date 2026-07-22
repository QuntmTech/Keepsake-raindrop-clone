import { getBackend } from '@/lib/backend';
import { getSettings, watchSettings } from '@/lib/settings';
import { createHighlight, highlightsForUrl, parseAnchor } from '@/lib/highlights';
import { mountQuickBar, type QuickBarApi } from '@/lib/quickbar';
import {
  type AiSelectionReplaceResult,
  type AiSelectionResult,
  type Message,
} from '@/lib/messaging';
import { type HighlightColor, type TextQuoteAnchor } from '@/lib/types';

type TextInput = HTMLInputElement | HTMLTextAreaElement;

type CapturedSelection =
  | { kind: 'input'; element: TextInput; start: number; end: number; text: string }
  | { kind: 'contenteditable'; root: HTMLElement; range: Range; text: string }
  | { kind: 'page'; range: Range; text: string };

type SelectionUndo =
  | { kind: 'input'; element: TextInput; value: string; start: number; end: number }
  | { kind: 'contenteditable'; inserted: Text; original: string; root: HTMLElement };

let capturedSelection: CapturedSelection | null = null;
let selectionUndo: SelectionUndo | null = null;

function isEditableInput(element: Element | null): element is TextInput {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return false;
  return ['text', 'search', 'email', 'url', 'tel', 'number'].includes(element.type || 'text');
}

function captureSelectionSnapshot(): CapturedSelection | null {
  const active = document.activeElement;
  if (isEditableInput(active)) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? start;
    if (end > start) {
      const text = active.value.slice(start, end);
      if (text.trim()) return { kind: 'input', element: active, start, end, text };
    }
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const text = selection.toString();
  if (!text.trim()) return null;
  const range = selection.getRangeAt(0).cloneRange();
  const common = range.commonAncestorContainer instanceof Element
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  const root = common?.closest<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"]') ?? null;
  return root ? { kind: 'contenteditable', root, range, text } : { kind: 'page', range, text };
}

function rememberSelection(): CapturedSelection | null {
  const next = captureSelectionSnapshot();
  if (next) capturedSelection = next;
  return capturedSelection;
}

function selectionResult(): AiSelectionResult {
  const selected = rememberSelection();
  if (!selected) {
    return {
      ok: true,
      text: '',
      editable: false,
      source: 'none',
      pageUrl: location.href,
      pageTitle: document.title,
    };
  }
  return {
    ok: true,
    text: selected.text,
    editable: selected.kind !== 'page',
    source: selected.kind,
    pageUrl: location.href,
    pageTitle: document.title,
  };
}

function dispatchTextInput(element: Element, data: string | null, inputType: string) {
  try {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data, inputType }));
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
}

function replaceCapturedSelection(text: string, expectedOriginal: string): AiSelectionReplaceResult {
  const selected = capturedSelection;
  if (!selected || selected.kind === 'page') {
    return { ok: false, error: 'Select text inside an editable field first.' };
  }
  if (!text.trim()) return { ok: false, error: 'The replacement is empty.' };
  if (selected.text !== expectedOriginal) {
    return { ok: false, error: 'The selected text changed. Select it again and retry.' };
  }

  if (selected.kind === 'input') {
    const { element, start, end } = selected;
    if (!element.isConnected || element.value.slice(start, end) !== selected.text) {
      return { ok: false, error: 'The editable field changed. Select the text again.' };
    }
    selectionUndo = { kind: 'input', element, value: element.value, start, end };
    element.focus();
    element.setRangeText(text, start, end, 'end');
    dispatchTextInput(element, text, 'insertReplacementText');
    const nextStart = start;
    const nextEnd = start + text.length;
    element.setSelectionRange(nextStart, nextEnd);
    capturedSelection = { kind: 'input', element, start: nextStart, end: nextEnd, text };
    return { ok: true, undoAvailable: true };
  }

  const { range, root } = selected;
  if (!root.isConnected || !range.commonAncestorContainer.isConnected || range.toString() !== selected.text) {
    return { ok: false, error: 'The editable text changed. Select it again.' };
  }
  selectionUndo = null;
  range.deleteContents();
  const inserted = document.createTextNode(text);
  range.insertNode(inserted);
  selectionUndo = { kind: 'contenteditable', inserted, original: selected.text, root };
  const nextRange = document.createRange();
  nextRange.selectNodeContents(inserted);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(nextRange);
  dispatchTextInput(root, text, 'insertReplacementText');
  capturedSelection = { kind: 'contenteditable', root, range: nextRange.cloneRange(), text };
  return { ok: true, undoAvailable: true };
}

function undoCapturedReplacement(): AiSelectionReplaceResult {
  const undo = selectionUndo;
  if (!undo) return { ok: false, error: 'There is no AI replacement to undo.' };

  if (undo.kind === 'input') {
    const { element, value, start, end } = undo;
    if (!element.isConnected) return { ok: false, error: 'The original field is no longer available.' };
    element.focus();
    element.value = value;
    element.setSelectionRange(start, end);
    dispatchTextInput(element, null, 'historyUndo');
    capturedSelection = { kind: 'input', element, start, end, text: value.slice(start, end) };
  } else {
    const { inserted, original, root } = undo;
    if (!inserted.isConnected || !root.isConnected) return { ok: false, error: 'The original text is no longer available.' };
    const restored = document.createTextNode(original);
    inserted.replaceWith(restored);
    const range = document.createRange();
    range.selectNodeContents(restored);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    dispatchTextInput(root, original, 'historyUndo');
    capturedSelection = { kind: 'contenteditable', root, range: range.cloneRange(), text: original };
  }
  selectionUndo = null;
  return { ok: true, undoAvailable: false };
}

// Content scripts run inside web pages. This one powers the draggable Quick Bar,
// selected-text AI actions, and robust quote-based highlights.
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  async main() {
    // Authentication/backend startup must never prevent the in-page control from
    // mounting. The Quick Bar handles signed-out and offline states itself.
    await getBackend().catch(() => null);
    const settings = await getSettings();

    let quickBarEnabled = settings.enableQuickBar;
    let quickBar: QuickBarApi | null = null;
    let mounting: Promise<QuickBarApi | null> | null = null;

    const ensureQuickBar = async () => {
      if (!quickBarEnabled) return null;
      if (quickBar && document.getElementById('keepsake-quickbar')) return quickBar;
      if (mounting) return mounting;
      mounting = mountQuickBar()
        .then((api) => {
          quickBar = api;
          return api;
        })
        .catch(() => null)
        .finally(() => {
          mounting = null;
        });
      return mounting;
    };

    if (quickBarEnabled) await ensureQuickBar();

    browser.runtime.onMessage.addListener((message: Message) => {
      if (message.type === 'OPEN_QUICKBAR') {
        ensureQuickBar().then((api) => api?.openFolders()).catch(() => {});
        return undefined;
      }
      if (message.type === 'KS_AI_SELECTION_GET') return Promise.resolve(selectionResult());
      if (message.type === 'KS_AI_SELECTION_REPLACE') {
        return Promise.resolve(replaceCapturedSelection(message.text, message.expectedOriginal));
      }
      if (message.type === 'KS_AI_SELECTION_UNDO') return Promise.resolve(undoCapturedReplacement());
      return undefined;
    });

    const rememberSoon = () => window.setTimeout(() => rememberSelection(), 0);
    document.addEventListener('selectionchange', rememberSelection, true);
    document.addEventListener('mouseup', rememberSoon, true);
    document.addEventListener('keyup', rememberSoon, true);
    document.addEventListener('focusin', rememberSoon, true);
    document.addEventListener('input', rememberSoon, true);

    watchSettings(async (next) => {
      quickBarEnabled = next.enableQuickBar;
      if (!quickBarEnabled) {
        quickBar?.destroy();
        quickBar = null;
        return;
      }
      const api = await ensureQuickBar();
      api?.update(next);
    });

    // Some highly dynamic sites replace documentElement children. If they remove
    // the host, clean up stale listeners and remount automatically.
    const observer = new MutationObserver(() => {
      if (!quickBarEnabled || document.getElementById('keepsake-quickbar')) return;
      quickBar?.destroy();
      quickBar = null;
      ensureQuickBar().catch(() => {});
    });
    observer.observe(document.documentElement, { childList: true });

    if (!settings.enableHighlights) return;

    injectStyles();
    await reapplyHighlights();

    let toolbar: HTMLDivElement | null = null;
    const closeToolbar = () => {
      toolbar?.remove();
      toolbar = null;
    };

    document.addEventListener('mousedown', (event) => {
      if (toolbar && !toolbar.contains(event.target as Node)) closeToolbar();
    });

    document.addEventListener('mouseup', (event) => {
      if (toolbar && toolbar.contains(event.target as Node)) return;
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || !selection || selection.rangeCount === 0) {
          closeToolbar();
          return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const anchor = buildAnchor(selection);
        closeToolbar();
        toolbar = buildToolbar(rect, async (color) => {
          await saveSelection(text, anchor, color);
          selection.removeAllRanges();
          closeToolbar();
        });
        document.body.appendChild(toolbar);
      }, 0);
    });
  },
});

const COLORS: Record<HighlightColor, string> = {
  yellow: '#fde047',
  green: '#86efac',
  blue: '#93c5fd',
  pink: '#f9a8d4',
  orange: '#fdba74',
};

interface Seg {
  node: Text;
  start: number;
}

function buildIndex(): { text: string; segs: Seg[] } {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      if (parent.closest('.ks-toolbar')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  const segs: Seg[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    segs.push({ node, start: text.length });
    text += node.nodeValue ?? '';
  }
  return { text, segs };
}

function buildAnchor(selection: Selection): TextQuoteAnchor {
  const exact = selection.toString();
  const { text } = buildIndex();
  const index = text.indexOf(exact);
  const context = 32;
  return {
    exact,
    prefix: index > 0 ? text.slice(Math.max(0, index - context), index) : undefined,
    suffix: index >= 0 ? text.slice(index + exact.length, index + exact.length + context) : undefined,
  };
}

function locate(text: string, anchor: TextQuoteAnchor): number {
  const { exact, prefix = '', suffix = '' } = anchor;
  if (!exact) return -1;
  let from = 0;
  let best = -1;
  let bestScore = -1;
  while (true) {
    const index = text.indexOf(exact, from);
    if (index < 0) break;
    const before = text.slice(Math.max(0, index - prefix.length), index);
    const after = text.slice(index + exact.length, index + exact.length + suffix.length);
    let score = 0;
    if (prefix && before.endsWith(prefix)) score += 2;
    if (suffix && after.startsWith(suffix)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
    from = index + 1;
  }
  return best;
}

function wrapRange(start: number, length: number, segs: Seg[], full: string, background: string) {
  const end = start + length;
  for (const seg of segs) {
    const nodeStart = seg.start;
    const nodeEnd = seg.start + (seg.node.nodeValue?.length ?? 0);
    if (nodeEnd <= start || nodeStart >= end) continue;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    try {
      const range = document.createRange();
      range.setStart(seg.node, from);
      range.setEnd(seg.node, to);
      const mark = document.createElement('mark');
      mark.className = 'ks-highlight';
      mark.style.background = background;
      range.surroundContents(mark);
    } catch {
      /* page changed during the walk */
    }
  }
  void full;
}

function buildToolbar(rect: DOMRect, onPick: (color: HighlightColor) => void): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'ks-toolbar';
  bar.style.top = `${window.scrollY + rect.top - 46}px`;
  bar.style.left = `${window.scrollX + rect.left}px`;
  (Object.keys(COLORS) as HighlightColor[]).forEach((color) => {
    const dot = document.createElement('button');
    dot.className = 'ks-dot';
    dot.style.background = COLORS[color];
    dot.title = `Highlight ${color}`;
    dot.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onPick(color);
    };
    bar.appendChild(dot);
  });
  return bar;
}

async function saveSelection(text: string, anchor: TextQuoteAnchor, color: HighlightColor) {
  const { text: full, segs } = buildIndex();
  const start = locate(full, anchor);
  if (start >= 0) wrapRange(start, text.length, segs, full, COLORS[color]);
  try {
    await createHighlight({ url: location.href, text, color, anchor });
  } catch {
    /* visual highlight remains for this session */
  }
}

async function reapplyHighlights() {
  try {
    const saved = await highlightsForUrl(location.href);
    for (const highlight of saved) {
      const { text: full, segs } = buildIndex();
      const anchor = parseAnchor(highlight.anchor) ?? { exact: highlight.text };
      const start = locate(full, anchor);
      if (start >= 0) wrapRange(start, anchor.exact.length, segs, full, COLORS[highlight.color]);
    }
  } catch {
    /* not logged in or offline */
  }
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .ks-toolbar { position: absolute; z-index: 2147483647; display: flex; gap: 6px;
      padding: 7px 9px; background: #1f2937; border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,.35); }
    .ks-dot { width: 20px; height: 20px; border-radius: 50%;
      border: 1.5px solid rgba(255,255,255,.5); cursor: pointer; padding: 0;
      transition: transform .1s; }
    .ks-dot:hover { transform: scale(1.18); }
    .ks-highlight { border-radius: 2px; padding: 0 1px; box-decoration-break: clone;
      -webkit-box-decoration-break: clone; }
  `;
  document.head.appendChild(style);
}
