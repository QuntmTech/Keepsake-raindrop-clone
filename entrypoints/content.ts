import { getBackend } from '@/lib/backend';
import { getSettings, watchSettings } from '@/lib/settings';
import { createHighlight, highlightsForUrl, parseAnchor } from '@/lib/highlights';
import { mountQuickBar, type QuickBarApi } from '@/lib/quickbar';
import { type Message } from '@/lib/messaging';
import { type HighlightColor, type TextQuoteAnchor } from '@/lib/types';

// Content scripts run inside web pages. This one powers the draggable Quick Bar
// and robust quote-based highlights.
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
      }
    });

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
