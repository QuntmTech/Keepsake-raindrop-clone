from pathlib import Path
import json


dashboard_path = Path('components/home/DashboardWidgets.tsx')
dashboard = dashboard_path.read_text()

dashboard = dashboard.replace(
    "  WIDGET_SPAN,\n} from '@/lib/widgets';",
    "  WIDGET_SPAN,\n  type WidgetPos,\n} from '@/lib/widgets';",
)

start = dashboard.index('const COL_W = 300;')
end = dashboard.index('function WidgetSwitch(')

new_block = r'''const COL_W = 300; // one grid column
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

'''

dashboard = dashboard[:start] + new_block + dashboard[end:]
dashboard = dashboard.replace(
    "<section className={`flex min-h-[9rem] flex-col rounded-2xl border p-4 ${panelCls}`} style={cardStyle}>",
    "<section className={`flex h-full min-h-[9rem] flex-col rounded-2xl border p-4 ${panelCls}`} style={cardStyle}>",
)
dashboard = dashboard.replace(
    "<section className={`rounded-2xl border p-4 ${panelCls}`} style={cardStyle}>",
    "<section className={`flex h-full flex-col rounded-2xl border p-4 ${panelCls}`} style={cardStyle}>",
    1,
)
dashboard = dashboard.replace(
    '<div className="flex gap-2 overflow-x-auto pb-1">',
    '<div className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-1">',
    1,
)
dashboard_path.write_text(dashboard)

widgets_path = Path('lib/widgets.ts')
widgets = widgets_path.read_text()
widgets = widgets.replace(
    "export interface WidgetPos {\n  x: number;\n  y: number;\n}",
    "export interface WidgetPos {\n  x: number;\n  y: number;\n  width?: number;\n  height?: number;\n}",
)
widgets_path.write_text(widgets)

test_path = Path('scripts/test-widget-canvas-816.mjs')
test_path.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../components/home/DashboardWidgets.tsx', import.meta.url), 'utf8');
const widgets = readFileSync(new URL('../lib/widgets.ts', import.meta.url), 'utf8');

test('desktop widget canvas reaches the viewport edges', () => {
  assert.match(dashboard, /md:w-\[calc\(100vw-3rem\)\]/);
  assert.match(dashboard, /md:max-w-none/);
  assert.match(dashboard, /Math\.max\(0, Math\.min\(Math\.max\(0, cw - s\.width\)/);
});

test('widgets have persistent pointer-based resize controls', () => {
  assert.match(dashboard, /onResizeDown/);
  assert.match(dashboard, /cursor-nwse-resize/);
  assert.match(dashboard, /width: resize\.width/);
  assert.match(dashboard, /height: resize\.height/);
  assert.match(dashboard, /widgetLayoutStore\.setValue\(next\)/);
});

test('stored widget layouts remain backward compatible', () => {
  assert.match(widgets, /width\?: number/);
  assert.match(widgets, /height\?: number/);
  assert.match(widgets, /fallback: \{\}/);
});
''')

package_path = Path('package.json')
package = json.loads(package_path.read_text())
package['scripts']['test:widget-canvas-816'] = 'node --test scripts/test-widget-canvas-816.mjs'
if 'npm run test:widget-canvas-816' not in package['scripts']['test']:
    package['scripts']['test'] += ' && npm run test:widget-canvas-816'
package_path.write_text(json.dumps(package, indent=2) + '\n')
