import { loadAuth } from '@/lib/pocketbase';
import { getSettings } from '@/lib/settings';
import { createHighlight, highlightsForUrl } from '@/lib/highlights';
import { type HighlightColor } from '@/lib/types';

// Content scripts run INSIDE the web page. This one powers highlights/annotations.
// It shows a tiny floating toolbar when the user selects text, saves the highlight to
// PocketBase, and visually wraps the selection.

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  async main() {
    await loadAuth();
    const settings = await getSettings();
    if (!settings.enableHighlights) return;

    injectStyles();
    await reapplyHighlights();

    let toolbar: HTMLDivElement | null = null;

    document.addEventListener('mouseup', () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text || !selection || selection.rangeCount === 0) {
        toolbar?.remove();
        toolbar = null;
        return;
      }
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      toolbar?.remove();
      toolbar = buildToolbar(rect, async (color) => {
        await saveSelection(text, selection, color);
        toolbar?.remove();
        toolbar = null;
      });
      document.body.appendChild(toolbar);
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

function buildToolbar(rect: DOMRect, onPick: (c: HighlightColor) => void): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'rdc-toolbar';
  bar.style.top = `${window.scrollY + rect.top - 44}px`;
  bar.style.left = `${window.scrollX + rect.left}px`;
  (Object.keys(COLORS) as HighlightColor[]).forEach((color) => {
    const dot = document.createElement('button');
    dot.className = 'rdc-dot';
    dot.style.background = COLORS[color];
    dot.title = `Highlight ${color}`;
    dot.onclick = (e) => {
      e.preventDefault();
      onPick(color);
    };
    bar.appendChild(dot);
  });
  return bar;
}

async function saveSelection(text: string, selection: Selection, color: HighlightColor) {
  // Visually wrap the selection right away for instant feedback.
  try {
    const range = selection.getRangeAt(0);
    const mark = document.createElement('mark');
    mark.className = 'rdc-highlight';
    mark.style.background = COLORS[color];
    range.surroundContents(mark);
    selection.removeAllRanges();
  } catch {
    // surroundContents throws if the selection crosses element boundaries.
    // Claude Code TODO: use a range-splitting highlighter (e.g. the W3C apache-annotator
    // TextQuoteSelector approach) for robust multi-node highlighting + re-anchoring.
  }

  await createHighlight({ url: location.href, text, color });
}

// Re-apply highlights saved for this URL. Base version does a naive first-match text search.
// Claude Code TODO: replace with anchor-based re-application so it survives DOM changes.
async function reapplyHighlights() {
  try {
    const saved = await highlightsForUrl(location.href);
    for (const h of saved) {
      naiveHighlightFirstMatch(h.text, COLORS[h.color]);
    }
  } catch {
    /* not logged in or offline — skip */
  }
}

function naiveHighlightFirstMatch(text: string, bg: string) {
  if (!text) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const idx = node.nodeValue?.indexOf(text) ?? -1;
    if (idx >= 0 && node.parentElement && !node.parentElement.closest('.rdc-highlight')) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + text.length);
      const mark = document.createElement('mark');
      mark.className = 'rdc-highlight';
      mark.style.background = bg;
      try {
        range.surroundContents(mark);
      } catch {
        /* skip tricky nodes */
      }
      return;
    }
  }
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .rdc-toolbar { position: absolute; z-index: 2147483647; display: flex; gap: 6px;
      padding: 6px 8px; background: #1f2937; border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,.3); }
    .rdc-dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgba(255,255,255,.4);
      cursor: pointer; padding: 0; }
    .rdc-highlight { border-radius: 2px; padding: 0 1px; }
  `;
  document.head.appendChild(style);
}
