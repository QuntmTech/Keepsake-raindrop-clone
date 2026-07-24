import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  WIDGETS,
  type WidgetKey,
  notesStore,
  todosStore,
  type Todo,
  recentSaves,
  rediscoverSaves,
  pinToHome,
  getTopSites,
  getRecentlyClosed,
  restoreClosed,
  fetchWeather,
  weatherLook,
  type Weather,
  type TopSite,
  type ClosedTab,
  widgetLayoutStore,
  widgetCollapsedStore,
  WIDGET_SPAN,
  type WidgetPos,
} from '@/lib/widgets';
import { Favicon } from '@/components/Favicon';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { markVisited } from '@/lib/bookmarks';
import { faviconFor, safeDomain } from '@/lib/util';
import { normUrl } from '@/lib/appUrl';
import { type Bookmark } from '@/lib/types';

const genId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Widgets are below-the-fold garnish: their data loads AFTER the page has
// painted (idle callback, 1.5s cap) so they never compete with the launcher
// grid for the first frame.
function whenIdle(fn: () => void): () => void {
  const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => number);
  if (ric) {
    const id = ric(fn, { timeout: 1500 });
    return () => (window as any).cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 250);
  return () => clearTimeout(id);
}

interface Ctx {
  panelCls: string;
  labelCls: string;
  onDark: boolean;
  enabled: WidgetKey[];
  pinnedUrls: Set<string>;
  onChanged: () => void;
  cardStyle?: React.CSSProperties; // custom widget background color
}

const COL_W = 300; // one grid column
const GAP = 16;
const SNAP = 8; // drag + resize snap to this pixel grid
const MIN_WIDGET_W = 240;
const MIN_WIDGET_H = 120;
const MAX_WIDGET_H = 900;

// The dashboard is a viewport-wide free canvas on desktop. Every widget
// can be dragged by its grip and resized from its lower-right corner.
// Position and size are kept per device; older {x,y}-only layouts remain
// valid and simply use the normal default footprint until resized.
export function DashboardWidgets(ctx: Ctx) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [layout, setLayout] = useState<Record<string, WidgetPos>>({});
  const [defaults, setDefaults] = useState<Record<string, WidgetPos>>({});
  const [cols, setCols] = useState(3);
  const [canvasH, setCanvasH] = useState(240);
  const [drag, setDrag] = useState<{ key: string; x: number; y: number } | null>(null);
  const [resize, setResize] = useState<{ key: string; x: number; y: number; width: number; height: number } | null>(null);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    widgetLayoutStore.getValue().then(setLayout);
    return widgetLayoutStore.watch((v) => setLayout(v ?? {}));
  }, []);
  useEffect(() => {
    widgetCollapsedStore.getValue().then(setCollapsed);
    return widgetCollapsedStore.watch((v) => setCollapsed(v ?? []));
  }, []);

  const toggleCollapse = (k: string) => {
    const next = collapsed.includes(k) ? collapsed.filter((x) => x !== k) : [...collapsed, k];
    setCollapsed(next);
    widgetCollapsedStore.setValue(next).catch(() => {});
  };

  const defaultWidthOf = useCallback((k: WidgetKey, colCount: number) => {
    const span = Math.min(WIDGET_SPAN[k] ?? 1, colCount);
    return span * COL_W + (span - 1) * GAP;
  }, []);

  // Re-pack only widgets that have never been manually positioned. Saved
  // widgets stay where the user put them, while the canvas grows to fit.
  const repack = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const colCount = Math.max(1, Math.floor((cw + GAP) / (COL_W + GAP)));
    setCols(colCount);
    const colH = new Array(colCount).fill(0);
    const def: Record<string, WidgetPos> = {};
    let maxBottom = 0;

    for (const k of ctx.enabled) {
      const cell = cellRefs.current[k];
      const naturalH = cell?.offsetHeight ?? 0;
      const span = Math.min(WIDGET_SPAN[k] ?? 1, colCount);
      let bestCol = 0;
      let bestY = Infinity;

      for (let c = 0; c + span <= colCount; c++) {
        const y = Math.max(...colH.slice(c, c + span));
        if (y < bestY) {
          bestY = y;
          bestCol = c;
        }
      }

      if (!isFinite(bestY)) bestY = 0;
      def[k] = { x: bestCol * (COL_W + GAP), y: bestY };

      if (naturalH >= 8) {
        for (let i = bestCol; i < bestCol + span; i++) colH[i] = bestY + naturalH + GAP;
        const saved = layoutOrDef(k, def[k], layout);
        const effectiveH = collapsed.includes(k) ? 50 : saved.height ?? naturalH;
        maxBottom = Math.max(maxBottom, saved.y + effectiveH);
      }
    }

    setDefaults(def);
    setCanvasH(Math.max(maxBottom + GAP, 200));
  }, [collapsed, ctx.enabled, layout]);

  useLayoutEffect(() => {
    repack();
  }, [repack, drag, resize]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => repack());
    ro.observe(el);
    for (const k of ctx.enabled) {
      const cell = cellRefs.current[k];
      if (cell) ro.observe(cell);
    }
    window.addEventListener('resize', repack);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', repack);
    };
  }, [repack, ctx.enabled]);

  const dragStartRef = useRef<{ px: number; py: number; x: number; y: number; width: number } | null>(null);
  const onGripDown = (k: WidgetKey, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const cur = layoutOrDef(k, defaults[k], layout);
    const width = cellRefs.current[k]?.offsetWidth ?? layout[k]?.width ?? defaultWidthOf(k, cols);
    dragStartRef.current = { px: e.clientX, py: e.clientY, x: cur.x, y: cur.y, width };
    setDrag({ key: k, x: cur.x, y: cur.y });
  };
  const onGripMove = (k: WidgetKey, e: React.PointerEvent<HTMLButtonElement>) => {
    const s = dragStartRef.current;
    if (!s || drag?.key !== k) return;
    const cw = containerRef.current?.clientWidth ?? s.width;
    const snap = (n: number) => Math.round(n / SNAP) * SNAP;
    const x = Math.max(0, Math.min(Math.max(0, cw - s.width), snap(s.x + (e.clientX - s.px))));
    const y = Math.max(0, snap(s.y + (e.clientY - s.py)));
    setDrag({ key: k, x, y });
  };
  const onGripUp = (k: WidgetKey) => {
    if (drag?.key === k) {
      const next = { ...layout, [k]: { ...layout[k], x: drag.x, y: drag.y } };
      setLayout(next);
      widgetLayoutStore.setValue(next).catch(() => {});
    }
    dragStartRef.current = null;
    setDrag(null);
  };

  const resizeStartRef = useRef<{
    px: number;
    py: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const onResizeDown = (k: WidgetKey, e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const cell = cellRefs.current[k];
    const cur = layoutOrDef(k, defaults[k], layout);
    const width = cell?.offsetWidth ?? layout[k]?.width ?? defaultWidthOf(k, cols);
    const height = cell?.offsetHeight ?? layout[k]?.height ?? MIN_WIDGET_H;
    resizeStartRef.current = { px: e.clientX, py: e.clientY, x: cur.x, y: cur.y, width, height };
    setResize({ key: k, x: cur.x, y: cur.y, width, height });
  };
  const onResizeMove = (k: WidgetKey, e: React.PointerEvent<HTMLButtonElement>) => {
    const s = resizeStartRef.current;
    if (!s || resize?.key !== k) return;
    const cw = containerRef.current?.clientWidth ?? s.width;
    const snap = (n: number) => Math.round(n / SNAP) * SNAP;
    const maxWidth = Math.max(MIN_WIDGET_W, cw - s.x);
    const width = Math.max(MIN_WIDGET_W, Math.min(maxWidth, snap(s.width + (e.clientX - s.px))));
    const height = Math.max(MIN_WIDGET_H, Math.min(MAX_WIDGET_H, snap(s.height + (e.clientY - s.py))));
    setResize({ key: k, x: s.x, y: s.y, width, height });
  };
  const onResizeUp = (k: WidgetKey) => {
    if (resize?.key === k) {
      const next = {
        ...layout,
        [k]: {
          ...layout[k],
          x: resize.x,
          y: resize.y,
          width: resize.width,
          height: resize.height,
        },
      };
      setLayout(next);
      widgetLayoutStore.setValue(next).catch(() => {});
    }
    resizeStartRef.current = null;
    setResize(null);
  };

  if (!ctx.enabled.length) return null;

  const liveBottom = resize
    ? resize.y + resize.height + GAP
    : drag
      ? drag.y + (cellRefs.current[drag.key]?.offsetHeight ?? MIN_WIDGET_H) + GAP
      : 0;

  return (
    <div
      ref={containerRef}
      className="relative mx-auto mt-12 w-full max-w-5xl md:left-1/2 md:w-[calc(100vw-3rem)] md:max-w-none md:-translate-x-1/2"
      style={{ height: Math.max(canvasH, liveBottom) }}
    >
      {ctx.enabled.map((k) => {
        const saved = layout[k];
        const basePos = drag?.key === k ? drag : layoutOrDef(k, defaults[k], layout);
        const liveSize = resize?.key === k
          ? { width: resize.width, height: resize.height }
          : { width: saved?.width ?? defaultWidthOf(k, cols), height: saved?.height };
        const cw = containerRef.current?.clientWidth || liveSize.width;
        const width = Math.min(liveSize.width, cw);
        const pos = {
          x: Math.max(0, Math.min(Math.max(0, cw - width), basePos.x)),
          y: Math.max(0, basePos.y),
        };
        const isCol = collapsed.includes(k);
        const active = drag?.key === k || resize?.key === k;
        const height = isCol ? 50 : liveSize.height;

        return (
          <div
            key={k}
            ref={(el) => {
              cellRefs.current[k] = el;
            }}
            className={`group/w absolute ${active ? 'z-30' : 'z-10'}`}
            style={{
              left: pos.x,
              top: pos.y,
              width,
              ...(height ? { height } : {}),
              minWidth: Math.min(MIN_WIDGET_W, cw),
              minHeight: isCol ? 50 : MIN_WIDGET_H,
              maxWidth: cw,
              transition: active ? 'none' : 'left .12s, top .12s, width .12s, height .12s',
            }}
          >
            <div className="absolute -top-2 right-2 z-20 flex gap-1">
              <button
                className={`grid h-6 w-6 place-items-center rounded-md border border-line bg-surface-raised text-ink-faint shadow-card transition hover:text-brand group-hover/w:opacity-100 ${
                  isCol ? 'opacity-100' : 'opacity-0'
                }`}
                onClick={() => toggleCollapse(k)}
                title={isCol ? 'Expand' : 'Collapse'}
              >
                <Icon name="chevron" size={13} className={`transition ${isCol ? '-rotate-90' : 'rotate-90'}`} />
              </button>
              <button
                className={`grid h-6 w-6 cursor-grab place-items-center rounded-md border border-line bg-surface-raised text-ink-faint shadow-card transition hover:text-brand group-hover/w:opacity-100 ${
                  drag?.key === k ? 'cursor-grabbing opacity-100' : 'opacity-0'
                }`}
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => onGripDown(k, e)}
                onPointerMove={(e) => onGripMove(k, e)}
                onPointerUp={() => onGripUp(k)}
                onPointerCancel={() => onGripUp(k)}
                title="Drag to move this widget"
              >
                <Icon name="grip" size={13} />
              </button>
            </div>

            <div
              className={
                isCol
                  ? 'overflow-hidden rounded-2xl'
                  : 'h-full min-h-0 overflow-auto rounded-2xl'
              }
              style={isCol ? { maxHeight: 50 } : undefined}
            >
              <WidgetSwitch k={k} {...ctx} />
            </div>

            {!isCol && (
              <button
                className={`absolute -bottom-1 -right-1 z-20 hidden h-7 w-7 cursor-nwse-resize items-end justify-end rounded-br-2xl p-1 text-ink-faint opacity-0 transition hover:text-brand group-hover/w:opacity-100 md:flex ${
                  resize?.key === k ? 'opacity-100' : ''
                }`}
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => onResizeDown(k, e)}
                onPointerMove={(e) => onResizeMove(k, e)}
                onPointerUp={() => onResizeUp(k)}
                onPointerCancel={() => onResizeUp(k)}
                title="Drag to resize this widget"
                aria-label={`Resize ${WIDGETS.find((widget) => widget.key === k)?.label ?? k}`}
              >
                <span className="block h-3 w-3 rounded-[1px] border-b-2 border-r-2 border-current" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function layoutOrDef(k: string, def: WidgetPos | undefined, layout: Record<string, WidgetPos>): WidgetPos {
  return layout[k] ?? def ?? { x: 0, y: 0 };
}

function WidgetSwitch({ k, ...ctx }: Ctx & { k: WidgetKey }) {
  switch (k) {
    case 'jumpback':
      return <SavesStrip title="Jump back in" icon="inbox" fetcher={recentSaves} {...ctx} />;
    case 'rediscover':
      return <SavesStrip title="Rediscover" icon="sparkles" fetcher={rediscoverSaves} {...ctx} />;
    case 'notes':
      return <NotesWidget {...ctx} />;
    case 'todo':
      return <TodoWidget {...ctx} />;
    case 'topsites':
      return <TopSitesWidget {...ctx} />;
    case 'recentclosed':
      return <RecentClosedWidget {...ctx} />;
    case 'weather':
      return <WeatherWidget {...ctx} />;
    default:
      return null;
  }
}

// ── card shell ───────────────────────────────────────────────────────────────
function Card({ title, icon, panelCls, cardStyle, right, children }: { title: string; icon: any; panelCls: string; cardStyle?: React.CSSProperties; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`flex h-full min-h-[9rem] flex-col rounded-2xl border p-4 ${panelCls}`} style={cardStyle}>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon name={icon} size={15} className="text-ink-faint" />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="ml-auto">{right}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

// ── "surface my stuff" strips ────────────────────────────────────────────────
function SavesStrip({
  title,
  icon,
  fetcher,
  panelCls,
  labelCls,
  onDark,
  cardStyle,
}: Ctx & { title: string; icon: any; fetcher: (limit?: number) => Promise<Bookmark[]> }) {
  const [items, setItems] = useState<Bookmark[] | null>(null);
  useEffect(() => whenIdle(() => fetcher(8).then(setItems).catch(() => setItems([]))), [fetcher]);
  if (items && items.length === 0) return null; // nothing to show — collapse

  const open = (b: Bookmark) => {
    markVisited(b.id).catch(() => {});
    window.location.href = b.url;
  };
  return (
    <section className={`flex h-full flex-col rounded-2xl border p-4 ${panelCls}`} style={cardStyle}>
      <div className="mb-3 flex items-center gap-2">
        <Icon name={icon} size={15} className="text-ink-faint" />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-1">
        {(items ?? Array.from({ length: 5 })).map((b, i) =>
          b ? (
            <button
              key={b.id}
              onClick={() => open(b)}
              onAuxClick={(e) => e.button === 1 && (e.preventDefault(), window.open(b.url, '_blank', 'noopener'))}
              className="group flex w-40 shrink-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-2.5 text-left transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-card"
              title={`${b.title}\n${b.url}`}
            >
              <span className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-raised">
                  <Favicon src={b.favicon} size={14} label={b.title} />
                </span>
                <span className="truncate text-xs font-medium text-ink">{b.title}</span>
              </span>
              <span className="truncate text-[11px] text-ink-faint">{b.domain || b.url}</span>
            </button>
          ) : (
            <div key={i} className="h-16 w-40 shrink-0 animate-pulse rounded-xl border border-line bg-surface" />
          ),
        )}
      </div>
    </section>
  );
}

// ── notes ────────────────────────────────────────────────────────────────────
function NotesWidget({ panelCls, cardStyle }: Ctx) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(true);
  const first = useRef(true);
  useEffect(() => {
    notesStore.getValue().then((v) => setText(v));
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved(false);
    const id = setTimeout(() => {
      notesStore.setValue(text).then(() => setSaved(true));
    }, 500);
    return () => clearTimeout(id);
  }, [text]);
  return (
    <Card title="Quick notes" icon="edit" panelCls={panelCls} cardStyle={cardStyle} right={<span className="text-[10px] text-ink-faint">{saved ? 'Saved' : '…'}</span>}>
      <textarea
        className="h-full min-h-[6rem] w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        placeholder="Jot something down… it saves automatically."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Card>
  );
}

// ── to-do ────────────────────────────────────────────────────────────────────
function TodoWidget({ panelCls, cardStyle }: Ctx) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    todosStore.getValue().then(setTodos);
  }, []);
  const persist = (next: Todo[]) => {
    setTodos(next);
    todosStore.setValue(next).catch(() => {});
  };
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    persist([...todos, { id: genId(), text: t, done: false }]);
    setDraft('');
  };
  const toggle = (id: string) => persist(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => persist(todos.filter((t) => t.id !== id));
  const doneCount = todos.filter((t) => t.done).length;

  return (
    <Card
      title="To-do"
      icon="check"
      panelCls={panelCls}
      cardStyle={cardStyle}
      right={
        doneCount > 0 ? (
          <button className="text-[10px] text-ink-faint hover:text-brand" onClick={() => persist(todos.filter((t) => !t.done))}>
            Clear done
          </button>
        ) : null
      }
    >
      <div className="flex h-full flex-col">
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2">
          <Icon name="plus" size={13} className="text-ink-faint" />
          <input
            className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-faint"
            placeholder="Add a task…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {todos.length === 0 && <li className="py-4 text-center text-xs text-ink-faint">Nothing yet — add your first task.</li>}
          {todos.map((t) => (
            <li key={t.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-sunken">
              <button
                onClick={() => toggle(t.id)}
                className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${t.done ? 'border-brand bg-brand text-white' : 'border-line'}`}
              >
                {t.done && <Icon name="check" size={11} />}
              </button>
              <span className={`flex-1 truncate text-sm ${t.done ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.text}</span>
              <button className="opacity-0 transition group-hover:opacity-100" onClick={() => remove(t.id)} title="Delete">
                <Icon name="close" size={13} className="text-ink-faint hover:text-red-500" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ── most visited (top sites) ─────────────────────────────────────────────────
function TopSitesWidget({ panelCls, cardStyle, pinnedUrls, onChanged }: Ctx) {
  const [sites, setSites] = useState<TopSite[] | null>(null);
  const { toast } = useToast();
  useEffect(() => whenIdle(() => getTopSites(8).then(setSites).catch(() => setSites([]))), []);
  if (sites && sites.length === 0) return null;
  const pin = async (s: TopSite) => {
    try {
      await pinToHome(s.url, s.title);
      toast(`Pinned ${s.title} to Home`, 'success');
      onChanged();
    } catch {
      toast('Could not pin that site', 'error');
    }
  };
  return (
    <Card title="Most visited" icon="grid" panelCls={panelCls} cardStyle={cardStyle}>
      <ul className="space-y-0.5">
        {(sites ?? []).map((s) => {
          const pinned = pinnedUrls.has(normUrl(s.url));
          return (
            <li key={s.url} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-sunken">
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-raised">
                <Favicon src={faviconFor(safeDomain(s.url))} size={14} label={s.title} />
              </span>
              <a href={s.url} className="flex-1 truncate text-sm text-ink hover:text-brand" title={s.url}>
                {s.title}
              </a>
              <button
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] transition ${
                  pinned ? 'text-ink-faint' : 'text-brand opacity-0 hover:bg-brand/10 group-hover:opacity-100'
                }`}
                disabled={pinned}
                onClick={() => pin(s)}
                title={pinned ? 'Already on Home' : 'Pin to Home'}
              >
                {pinned ? '✓ pinned' : '+ pin'}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── recently closed ──────────────────────────────────────────────────────────
function RecentClosedWidget({ panelCls, cardStyle, pinnedUrls, onChanged }: Ctx) {
  const [tabs, setTabs] = useState<ClosedTab[] | null>(null);
  const { toast } = useToast();
  useEffect(() => whenIdle(() => getRecentlyClosed(7).then(setTabs).catch(() => setTabs([]))), []);
  if (tabs && tabs.length === 0) return null;
  const pin = async (t: ClosedTab) => {
    try {
      await pinToHome(t.url, t.title);
      toast(`Pinned ${t.title} to Home`, 'success');
      onChanged();
    } catch {
      toast('Could not pin that site', 'error');
    }
  };
  return (
    <Card title="Recently closed" icon="import" panelCls={panelCls} cardStyle={cardStyle}>
      <ul className="space-y-0.5">
        {(tabs ?? []).map((t, i) => {
          const pinned = pinnedUrls.has(normUrl(t.url));
          return (
            <li key={`${t.url}-${i}`} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-sunken">
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-raised">
                <Favicon src={faviconFor(safeDomain(t.url))} size={14} label={t.title} />
              </span>
              <button
                onClick={() => (t.sessionId ? restoreClosed(t.sessionId) : window.open(t.url, '_blank'))}
                className="flex-1 truncate text-left text-sm text-ink hover:text-brand"
                title={`Reopen ${t.url}`}
              >
                {t.title}
              </button>
              <button
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] transition ${
                  pinned ? 'text-ink-faint' : 'text-brand opacity-0 hover:bg-brand/10 group-hover:opacity-100'
                }`}
                disabled={pinned}
                onClick={() => pin(t)}
                title={pinned ? 'Already on Home' : 'Pin to Home'}
              >
                {pinned ? '✓ pinned' : '+ pin'}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── weather ──────────────────────────────────────────────────────────────────
function WeatherWidget({ panelCls, cardStyle }: Ctx) {
  const [w, setW] = useState<Weather | null | 'loading'>('loading');
  useEffect(() => whenIdle(() => fetchWeather().then((r) => setW(r)).catch(() => setW(null))), []);
  if (w === null) return null; // no permission / offline — hide
  const look = w && w !== 'loading' ? weatherLook(w.code) : null;
  return (
    <Card title="Weather" icon="image" panelCls={panelCls} cardStyle={cardStyle}>
      {w === 'loading' ? (
        <p className="py-4 text-center text-xs text-ink-faint">Loading…</p>
      ) : (
        <div className="flex items-center gap-3 py-1">
          <span className="text-4xl">{look?.icon}</span>
          <div>
            <p className="text-2xl font-semibold text-ink">
              {w.tempF}°<span className="text-sm text-ink-faint">F · {w.tempC}°C</span>
            </p>
            <p className="text-xs text-ink-soft">
              {look?.label}
              {w.place ? ` · ${w.place}` : ''}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
