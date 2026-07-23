import { getSettings, watchSettings } from '@/lib/settings';
import { type PageSnapshot } from '@/lib/pageAi';

interface EditableText {
  text: string;
  rect: DOMRect;
  selected: boolean;
}

function isTextInput(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) return false;
  return ['text', 'search', 'email', 'url', 'tel', 'number'].includes(element.type || 'text');
}

function selectedEditable(): EditableText | null {
  const active = document.activeElement;
  if (isTextInput(active)) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? start;
    if (end <= start) return null;
    const text = active.value.slice(start, end);
    if (!text.trim()) return null;
    return { text: text.slice(0, 48_000), rect: active.getBoundingClientRect(), selected: true };
  }

  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const text = selection.toString().trim();
    if (text) return { text: text.slice(0, 48_000), rect: selection.getRangeAt(0).getBoundingClientRect(), selected: true };
  }

  // Privacy default: never send an entire contenteditable field implicitly.
  // The user must select the exact text they want Keepsake to process.
  return null;
}

function pageText(max = 90_000): string {
  const root = document.querySelector('main, article, [role="main"]') ?? document.body;
  if (!root) return '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('script, style, noscript, nav, header, footer, aside, [aria-hidden="true"], #keepsake-ai-embed')) {
        return NodeFilter.FILTER_REJECT;
      }
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const parts: string[] = [];
  let length = 0;
  let node: Node | null;
  while ((node = walker.nextNode()) && length < max) {
    const value = node.nodeValue?.replace(/\s+/g, ' ').trim();
    if (!value) continue;
    parts.push(value);
    length += value.length + 1;
  }
  return parts.join('\n').slice(0, max);
}

function snapshot(): PageSnapshot {
  const description = document
    .querySelector('meta[name="description"], meta[property="og:description"]')
    ?.getAttribute('content')
    ?.trim();
  const selection = window.getSelection()?.toString().trim() || undefined;
  return {
    title: document.title || location.hostname,
    url: location.href,
    description: description || undefined,
    text: pageText(),
    selectedText: selection?.slice(0, 48_000),
    capturedAt: Date.now(),
  };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  async main(ctx) {
    // Page AI remains available even when the visible selection helper is off.
    const onRuntimeMessage = (message: { type?: string }) => {
      if (message.type === 'KS_AI_PAGE_GET') return Promise.resolve({ ok: true, page: snapshot() });
      return undefined;
    };
    browser.runtime.onMessage.addListener(onRuntimeMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onRuntimeMessage));

    let disposeBubble: (() => void) | null = null;

    const mountBubble = () => {
      if (disposeBubble || document.getElementById('keepsake-ai-embed')) return;

      const host = document.createElement('div');
      host.id = 'keepsake-ai-embed';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        button { position: fixed; z-index: 2147483647; display: none; align-items: center; gap: 6px;
          border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 7px 10px;
          background: linear-gradient(135deg,#6d5dfc,#3b82f6); color: #fff; cursor: pointer;
          box-shadow: 0 8px 26px rgba(15,23,42,.35); font: 700 11px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
          opacity: .96; transform: translateY(0); transition: transform .12s, filter .12s, opacity .12s; }
        button:hover { filter: brightness(1.08); transform: translateY(-1px); }
        button:active { transform: scale(.96); }
        svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
      `;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', 'Open selected text in Keepsake AI Writer');
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z"/></svg><span>AI Writer</span>';
      shadow.append(style, button);
      (document.documentElement || document.body).appendChild(host);

      let current: EditableText | null = null;
      let timer = 0;
      const cleanups: Array<() => void> = [];

      const listen = <K extends keyof DocumentEventMap>(
        target: Document | Window,
        type: K | string,
        listener: EventListener,
        options?: AddEventListenerOptions | boolean,
      ) => {
        target.addEventListener(type, listener, options);
        cleanups.push(() => target.removeEventListener(type, listener, options));
      };

      const hide = () => {
        current = null;
        button.style.display = 'none';
      };

      const position = () => {
        const next = selectedEditable();
        if (!next) {
          hide();
          return;
        }
        current = next;
        const width = 92;
        const x = Math.max(8, Math.min(window.innerWidth - width - 8, next.rect.right - width));
        const y = Math.max(8, Math.min(window.innerHeight - 38, next.selected ? next.rect.top - 38 : next.rect.bottom - 36));
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
        button.style.display = 'inline-flex';
        button.querySelector('span')!.textContent = next.selected ? 'Rewrite' : 'AI Writer';
      };

      const schedule = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(position, 60);
      };

      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const selected = current ?? selectedEditable();
        if (!selected?.text) return;
        button.style.display = 'none';
        const response = (await browser.runtime
          .sendMessage({
            type: 'OPEN_AI_TOOLS',
            text: selected.text,
            action: selected.selected ? 'improve' : 'rewrite',
            source: 'embedded',
          })
          .catch(() => null)) as { ok?: boolean } | null;
        if (!response?.ok) button.style.display = 'inline-flex';
      });

      listen(document, 'selectionchange', schedule as EventListener, true);
      listen(document, 'mouseup', schedule as EventListener, true);
      listen(document, 'keyup', schedule as EventListener, true);
      listen(document, 'focusin', schedule as EventListener, true);
      listen(document, 'input', schedule as EventListener, true);
      listen(document, 'mousedown', ((event: Event) => {
        if (event.composedPath().includes(host)) return;
        window.setTimeout(schedule, 0);
      }) as EventListener, true);
      listen(window, 'scroll', hide as EventListener, true);
      listen(window, 'resize', hide as EventListener);

      disposeBubble = () => {
        window.clearTimeout(timer);
        for (const cleanup of cleanups) cleanup();
        host.remove();
        disposeBubble = null;
      };
    };

    const applySettings = (enabled: boolean) => {
      if (enabled) mountBubble();
      else disposeBubble?.();
    };

    const settings = await getSettings();
    applySettings(settings.enableAiSelectionTools);
    const unwatch = watchSettings((next) => applySettings(next.enableAiSelectionTools));

    ctx.onInvalidated(() => {
      unwatch();
      disposeBubble?.();
    });
  },
});
