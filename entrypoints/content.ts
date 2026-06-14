import { getBackend } from '@/lib/backend';
import { getSettings } from '@/lib/settings';
import { createHighlight, highlightsForUrl, parseAnchor } from '@/lib/highlights';
import { type HighlightColor, type TextQuoteAnchor } from '@/lib/types';

// Content scripts run INSIDE the web page. This one powers highlights/annotations
// with robust quote-based anchoring (quote + surrounding context) so highlights
// survive DOM changes and span multiple nodes.

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  async main() {
    await getBackend();
    const settings = await getSettings();
    if (!settings.enableHighlights) return;

    injectStyles();
    await reapplyHighlights();

    let toolbar: HTMLDivElement | null = null;
    const closeToolbar = () => {
      toolbar?.remove();
      toolbar = null;
    };

    document.addEventListener('mousedown', (e) => {
      if (toolbar && !toolbar.contains(e.target as Node)) closeToolbar();
    });

    document.addEventListener('mouseup', (e) => {
      // Ignore clicks on the toolbar itself — otherwise picking a color would
      // rebuild the toolbar mid-click and swallow the color button's handler.
      if (toolbar && toolbar.contains(e.target as Node)) return;
      // Defer so the selection is finalized.
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

// ---- anchoring -------------------------------------------------------------

// Flatten the page into a single string and remember where each text node sits,
// so we can map character offsets back to DOM ranges.
interface Seg {
  node: Text;
  start: number;
}
function buildIndex(): { text: string; segs: Seg[] } {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      const tag = p.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      if (p.closest('.ks-toolbar')) return NodeFilter.FILTER_REJECT;
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
  const idx = text.indexOf(exact);
  const CTX = 32;
  return {
    exact,
    prefix: idx > 0 ? text.slice(Math.max(0, idx - CTX), idx) : undefined,
    suffix: idx >= 0 ? text.slice(idx + exact.length, idx + exact.length + CTX) : undefined,
  };
}

// Locate the global offset of an anchor's quote, disambiguating with context.
function locate(text: string, anchor: TextQuoteAnchor): number {
  const { exact, prefix = '', suffix = '' } = anchor;
  if (!exact) return -1;
  // Prefer the occurrence whose surrounding text matches the saved context.
  let from = 0;
  let best = -1;
  let bestScore = -1;
  while (true) {
    const i = text.indexOf(exact, from);
    if (i < 0) break;
    const before = text.slice(Math.max(0, i - prefix.length), i);
    const after = text.slice(i + exact.length, i + exact.length + suffix.length);
    let score = 0;
    if (prefix && before.endsWith(prefix)) score += 2;
    if (suffix && after.startsWith(suffix)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
    from = i + 1;
  }
  return best;
}

// Wrap the character span [start, start+len) by slicing each intersecting text node.
function wrapRange(start: number, len: number, segs: Seg[], full: string, bg: string) {
  const end = start + len;
  for (const seg of segs) {
    const nodeStart = seg.start;
    const nodeEnd = seg.start + (seg.node.nodeValue?.length ?? 0);
    if (nodeEnd <= start || nodeStart >= end) continue; // no overlap
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    try {
      const range = document.createRange();
      range.setStart(seg.node, from);
      range.setEnd(seg.node, to);
      const mark = document.createElement('mark');
      mark.className = 'ks-highlight';
      mark.style.background = bg;
      range.surroundContents(mark);
    } catch {
      /* node mutated mid-walk — skip this slice */
    }
  }
  void full;
}

// ---- toolbar + persistence -------------------------------------------------

function buildToolbar(rect: DOMRect, onPick: (c: HighlightColor) => void): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'ks-toolbar';
  bar.style.top = `${window.scrollY + rect.top - 46}px`;
  bar.style.left = `${window.scrollX + rect.left}px`;
  (Object.keys(COLORS) as HighlightColor[]).forEach((color) => {
    const dot = document.createElement('button');
    dot.className = 'ks-dot';
    dot.style.background = COLORS[color];
    dot.title = `Highlight ${color}`;
    dot.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPick(color);
    };
    bar.appendChild(dot);
  });
  return bar;
}

async function saveSelection(text: string, anchor: TextQuoteAnchor, color: HighlightColor) {
  // Visual feedback immediately.
  const { text: full, segs } = buildIndex();
  const start = locate(full, anchor);
  if (start >= 0) wrapRange(start, text.length, segs, full, COLORS[color]);
  try {
    await createHighlight({ url: location.href, text, color, anchor });
  } catch {
    /* not logged in / offline — visual highlight still shown this session */
  }
}

async function reapplyHighlights() {
  try {
    const saved = await highlightsForUrl(location.href);
    for (const h of saved) {
      const { text: full, segs } = buildIndex();
      const anchor = parseAnchor(h.anchor) ?? { exact: h.text };
      const start = locate(full, anchor);
      if (start >= 0) wrapRange(start, anchor.exact.length, segs, full, COLORS[h.color]);
    }
  } catch {
    /* not logged in or offline — skip */
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
