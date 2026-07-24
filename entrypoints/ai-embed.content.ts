import { getSettings, setSettings, watchSettings } from '@/lib/settings';
import { orderedSelectionActions, type ResolvedSelectionAction } from '@/lib/selectionActions';
import { type PageSnapshot } from '@/lib/pageAi';
import { type Settings } from '@/lib/types';

interface EditableText {
  text: string;
  rect: DOMRect;
  source: 'input' | 'contenteditable' | 'page';
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
    return { text: text.slice(0, 48_000), rect: active.getBoundingClientRect(), source: 'input' };
  }

  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const text = selection.toString().trim();
    if (text) {
      const range = selection.getRangeAt(0);
      const parent =
        range.commonAncestorContainer instanceof Element
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      const contenteditable = Boolean(parent?.closest('[contenteditable]:not([contenteditable="false"])'));
      return {
        text: text.slice(0, 48_000),
        rect: range.getBoundingClientRect(),
        source: contenteditable ? 'contenteditable' : 'page',
      };
    }
  }

  // Privacy default: never send an entire field implicitly.
  return null;
}

function pageText(max = 90_000): string {
  const root = document.querySelector('main, article, [role="main"]') ?? document.body;
  if (!root) return '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (
        parent.closest(
          'script, style, noscript, nav, header, footer, aside, [aria-hidden="true"], #keepsake-ai-embed',
        )
      ) {
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

function normalizeSite(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .replace(/:\d+$/, '');
}

function currentSite(): string {
  return normalizeSite(location.hostname);
}

function siteBlocked(settings: Settings): boolean {
  const host = currentSite();
  return settings.aiSelectionBlockedSites.some((value) => {
    const blocked = normalizeSite(value);
    return Boolean(blocked && (host === blocked || host.endsWith(`.${blocked}`)));
  });
}

function selectionAllowed(settings: Settings, selection: EditableText): boolean {
  if (selection.source === 'page') return settings.aiSelectionShowForReading;
  return settings.aiSelectionShowForWriting;
}

function fingerprint(selection: EditableText): string {
  const rect = selection.rect;
  return `${selection.source}:${selection.text}:${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}`;
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

    let settings = await getSettings();
    let disposeBubble: (() => void) | null = null;
    let refreshBubble: (() => void) | null = null;

    const mountBubble = () => {
      if (disposeBubble || document.getElementById('keepsake-ai-embed')) return;

      const host = document.createElement('div');
      host.id = 'keepsake-ai-embed';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        * { box-sizing: border-box; }
        .toolbar {
          position: fixed; z-index: 2147483647; display: none; align-items: center; gap: 3px;
          max-width: min(520px, calc(100vw - 16px)); padding: 4px;
          border: 1px solid rgba(255,255,255,.2); border-radius: 12px;
          background: rgba(15,23,42,.96); color: #fff;
          box-shadow: 0 12px 36px rgba(2,6,23,.38); backdrop-filter: blur(14px);
          font: 600 11px/1.1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
        }
        .quick {
          border: 0; border-radius: 8px; padding: 7px 9px; background: transparent;
          color: #f8fafc; cursor: pointer; white-space: nowrap; font: inherit;
        }
        .quick:hover, .icon:hover { background: rgba(255,255,255,.12); }
        .quick:first-child { background: linear-gradient(135deg,#6d5dfc,#3b82f6); }
        .icon {
          display: grid; place-items: center; width: 28px; height: 28px; border: 0;
          border-radius: 8px; background: transparent; color: #cbd5e1; cursor: pointer;
          font: 700 15px/1 ui-sans-serif,system-ui;
        }
        .menu {
          position: fixed; z-index: 2147483647; display: none;
          width: min(290px, calc(100vw - 16px)); max-height: min(420px, calc(100vh - 16px));
          overflow: auto; padding: 7px; border: 1px solid rgba(255,255,255,.16);
          border-radius: 14px; background: rgba(15,23,42,.98); color: #fff;
          box-shadow: 0 18px 48px rgba(2,6,23,.46); backdrop-filter: blur(16px);
          font: 500 12px/1.25 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
        }
        .menu-title {
          padding: 7px 8px 5px; color: #94a3b8; font-size: 10px; font-weight: 700;
          letter-spacing: .08em; text-transform: uppercase;
        }
        .menu-action, .menu-control {
          display: block; width: 100%; border: 0; border-radius: 9px; padding: 8px;
          background: transparent; color: #f8fafc; cursor: pointer; text-align: left; font: inherit;
        }
        .menu-action:hover, .menu-control:hover { background: rgba(255,255,255,.1); }
        .menu-action strong { display: block; font-size: 12px; }
        .menu-action span { display: block; margin-top: 2px; color: #94a3b8; font-size: 10px; }
        .divider { height: 1px; margin: 6px 3px; background: rgba(255,255,255,.12); }
        .danger { color: #fca5a5; }
        @media (max-width: 520px) { .quick:nth-of-type(n+3) { display: none; } }
      `;

      const toolbar = document.createElement('div');
      toolbar.className = 'toolbar';
      toolbar.setAttribute('role', 'toolbar');
      toolbar.setAttribute('aria-label', 'Keepsake AI actions for selected text');

      const quickActions = document.createElement('div');
      quickActions.style.display = 'contents';

      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'icon';
      more.textContent = '•••';
      more.setAttribute('aria-label', 'More Keepsake AI options');

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'icon';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Close Keepsake AI for this selection');
      toolbar.append(quickActions, more, close);

      const menu = document.createElement('div');
      menu.className = 'menu';
      menu.setAttribute('role', 'menu');
      shadow.append(style, toolbar, menu);
      (document.documentElement || document.body).appendChild(host);

      let current: EditableText | null = null;
      let timer = 0;
      let hiddenForVisit = false;
      let dismissedFingerprint = '';
      let menuOpen = false;
      const cleanups: Array<() => void> = [];

      const listen = (
        target: Document | Window,
        type: string,
        listener: EventListener,
        options?: AddEventListenerOptions | boolean,
      ) => {
        target.addEventListener(type, listener, options);
        cleanups.push(() => target.removeEventListener(type, listener, options));
      };

      const hideMenu = () => {
        menuOpen = false;
        menu.style.display = 'none';
      };

      const hideToolbar = () => {
        toolbar.style.display = 'none';
        hideMenu();
      };

      const hideCurrentSelection = () => {
        if (current) dismissedFingerprint = fingerprint(current);
        hideToolbar();
      };

      const placeMenu = () => {
        const left = parseFloat(toolbar.style.left || '8');
        const top = parseFloat(toolbar.style.top || '8');
        const menuWidth = 290;
        const menuHeight = Math.min(420, menu.scrollHeight || 360);
        menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menuWidth - 8, left))}px`;
        const below = top + toolbar.offsetHeight + 6;
        menu.style.top = `${
          below + menuHeight <= window.innerHeight - 8 ? below : Math.max(8, top - menuHeight - 6)
        }px`;
      };

      const runAction = async (action: ResolvedSelectionAction) => {
        const selected = current ?? selectedEditable();
        if (!selected?.text) return;
        hideCurrentSelection();

        // Send immediately from the click handler so Chrome still recognizes the
        // user gesture required by sidePanel.open(). The background persists the
        // complete draft after it starts opening the panel.
        const response = (await browser.runtime
          .sendMessage({
            type: 'OPEN_AI_TOOLS',
            text: selected.text,
            action: action.writerAction,
            customInstruction: action.customInstruction ?? '',
            targetLanguage: settings.aiSelectionTranslateLanguage || 'English',
            source: 'embedded',
          })
          .catch((error) => ({ ok: false, error: String(error) }))) as {
          ok?: boolean;
          error?: string;
          surface?: 'sidepanel' | 'tab';
        } | null;

        if (!response?.ok) {
          dismissedFingerprint = '';
          toolbar.style.display = 'inline-flex';
          toolbar.title = response?.error || 'Keepsake could not open the AI workspace.';
        }
      };

      const actionButton = (action: ResolvedSelectionAction, compact: boolean) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = compact ? 'quick' : 'menu-action';
        if (compact) button.textContent = action.shortLabel;
        else {
          const strong = document.createElement('strong');
          strong.textContent = action.label;
          const description = document.createElement('span');
          description.textContent = `${action.description} · ${action.creditCost} hosted credit${
            action.creditCost === 1 ? '' : 's'
          }`;
          button.append(strong, description);
        }
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          runAction(action).catch(() => {});
        });
        return button;
      };

      const controlButton = (
        label: string,
        handler: () => void | Promise<void>,
        danger = false,
      ) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `menu-control${danger ? ' danger' : ''}`;
        button.textContent = label;
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          Promise.resolve(handler()).catch(() => {});
        });
        return button;
      };

      const render = () => {
        const actions = orderedSelectionActions(
          settings.aiSelectionActions,
          settings.aiSelectionCustomActions,
        );
        quickActions.replaceChildren(...actions.slice(0, 3).map((action) => actionButton(action, true)));
        menu.replaceChildren();

        const title = document.createElement('div');
        title.className = 'menu-title';
        title.textContent = 'AI actions';
        menu.append(title, ...actions.map((action) => actionButton(action, false)));

        const divider = document.createElement('div');
        divider.className = 'divider';
        menu.append(
          divider,
          controlButton('Hide for this visit', () => {
            hiddenForVisit = true;
            hideToolbar();
          }),
          controlButton(`Disable on ${currentSite() || 'this website'}`, async () => {
            const site = currentSite();
            if (!site) return;
            await setSettings({
              aiSelectionBlockedSites: [...new Set([...settings.aiSelectionBlockedSites, site])],
            });
          }),
          controlButton('Customize actions…', async () => {
            hideToolbar();
            await browser.runtime.openOptionsPage();
          }),
          controlButton(
            'Turn off everywhere',
            async () => {
              await setSettings({ enableAiSelectionTools: false });
            },
            true,
          ),
        );
      };

      const position = () => {
        if (hiddenForVisit || siteBlocked(settings)) {
          hideToolbar();
          return;
        }
        const next = selectedEditable();
        if (!next || !selectionAllowed(settings, next)) {
          current = null;
          dismissedFingerprint = '';
          hideToolbar();
          return;
        }
        const nextFingerprint = fingerprint(next);
        if (dismissedFingerprint && dismissedFingerprint === nextFingerprint) return;
        if (dismissedFingerprint !== nextFingerprint) dismissedFingerprint = '';
        current = next;

        const actions = orderedSelectionActions(
          settings.aiSelectionActions,
          settings.aiSelectionCustomActions,
        );
        if (!actions.length) {
          hideToolbar();
          return;
        }

        render();
        const width = Math.min(480, Math.max(150, toolbar.scrollWidth || 260));
        const x = Math.max(8, Math.min(window.innerWidth - width - 8, next.rect.right - width));
        const y = Math.max(8, Math.min(window.innerHeight - 42, next.rect.top - 42));
        toolbar.style.left = `${x}px`;
        toolbar.style.top = `${y}px`;
        toolbar.style.display = 'inline-flex';
        if (menuOpen) {
          menu.style.display = 'block';
          placeMenu();
        }
      };

      const schedule = () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(position, 65);
      };

      toolbar.addEventListener('mousedown', (event) => event.preventDefault());
      more.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        menuOpen = !menuOpen;
        menu.style.display = menuOpen ? 'block' : 'none';
        if (menuOpen) placeMenu();
      });
      close.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideCurrentSelection();
      });

      listen(document, 'selectionchange', schedule as EventListener, true);
      listen(document, 'mouseup', schedule as EventListener, true);
      listen(document, 'keyup', schedule as EventListener, true);
      listen(document, 'focusin', schedule as EventListener, true);
      listen(document, 'input', schedule as EventListener, true);
      listen(
        document,
        'mousedown',
        ((event: Event) => {
          if (event.composedPath().includes(host)) return;
          hideMenu();
          window.setTimeout(schedule, 0);
        }) as EventListener,
        true,
      );
      listen(
        document,
        'keydown',
        ((event: Event) => {
          if (!(event instanceof KeyboardEvent) || event.key !== 'Escape') return;
          if (menuOpen) hideMenu();
          else hideCurrentSelection();
        }) as EventListener,
        true,
      );
      listen(window, 'scroll', hideToolbar as EventListener, true);
      listen(window, 'resize', hideToolbar as EventListener);

      refreshBubble = () => {
        render();
        if (current) position();
      };
      disposeBubble = () => {
        window.clearTimeout(timer);
        for (const cleanup of cleanups) cleanup();
        host.remove();
        refreshBubble = null;
        disposeBubble = null;
      };
    };

    const applySettings = (next: Settings) => {
      settings = next;
      if (next.enableAiSelectionTools && !siteBlocked(next)) {
        mountBubble();
        refreshBubble?.();
      } else {
        disposeBubble?.();
      }
    };

    applySettings(settings);
    const unwatch = watchSettings(applySettings);

    ctx.onInvalidated(() => {
      unwatch();
      disposeBubble?.();
    });
  },
});
