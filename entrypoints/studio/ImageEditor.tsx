import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

// The editor keeps one decoded source bitmap and a small preview canvas. Edits
// remain vector operations until export, when they are composed once at the
// requested resolution. This keeps 20–80 MP scrolling captures responsive.

export type ImageExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf';

export interface ImageExportOptions {
  format?: ImageExportFormat;
  quality?: number;
  maxPixels?: number;
}

export interface ImageEditorHandle {
  exportBlob(options?: ImageExportOptions): Promise<Blob>;
}

type Tool =
  | 'crop'
  | 'pen'
  | 'highlight'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'step'
  | 'blur'
  | 'pixelate'
  | 'redact'
  | 'eraser';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

type AnnoTool = Exclude<Tool, 'crop' | 'eraser'>;

interface Anno {
  id: string;
  tool: AnnoTool;
  color: string;
  width: number;
  opacity: number;
  points?: Point[];
  from?: Point;
  to?: Point;
  text?: string;
  number?: number;
}

interface EditorSnapshot {
  source: Rect;
  annos: Anno[];
}

type Draft =
  | { kind: 'crop'; from: Point; to: Point }
  | { kind: 'anno'; anno: Anno };

const COLORS = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#7c3aed', '#111827', '#ffffff'];
const SIZES: { key: string; label: string; mul: number }[] = [
  { key: 's', label: 'S', mul: 3 },
  { key: 'm', label: 'M', mul: 6 },
  { key: 'l', label: 'L', mul: 12 },
];
const PREVIEW_MAX_DIMENSION = 2200;
const PREVIEW_MAX_PIXELS = 3_200_000;
const HISTORY_LIMIT = 100;

const norm = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

const cloneAnnos = (annos: Anno[]): Anno[] =>
  annos.map((anno) => ({
    ...anno,
    points: anno.points?.map((point) => ({ ...point })),
    from: anno.from ? { ...anno.from } : undefined,
    to: anno.to ? { ...anno.to } : undefined,
  }));

const cloneSnapshot = (snapshot: EditorSnapshot): EditorSnapshot => ({
  source: { ...snapshot.source },
  annos: cloneAnnos(snapshot.annos),
});

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const ImageEditor = forwardRef<ImageEditorHandle, { blob: Blob; onEdited: () => void }>(
  function ImageEditor({ blob, onEdited }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const bitmapRef = useRef<ImageBitmap | null>(null);
    const sourceRef = useRef<Rect>({ x: 0, y: 0, w: 1, h: 1 });
    const annosRef = useRef<Anno[]>([]);
    const undoRef = useRef<EditorSnapshot[]>([]);
    const redoRef = useRef<EditorSnapshot[]>([]);
    const draftRef = useRef<Draft | null>(null);
    const cropPendingRef = useRef<Rect | null>(null);
    const drawingRef = useRef(false);
    const frameRef = useRef<number | null>(null);

    const [tool, setTool] = useState<Tool>('arrow');
    const [color, setColor] = useState(COLORS[0]);
    const [sizeKey, setSizeKey] = useState('m');
    const [opacity, setOpacity] = useState(100);
    const [zoom, setZoom] = useState<'fit' | 25 | 50 | 100 | 200>('fit');
    const [loaded, setLoaded] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [cropPending, setCropPendingState] = useState<Rect | null>(null);
    const [textDraft, setTextDraft] = useState<Point | null>(null);
    const [, bump] = useState(0);

    const setCropPending = (rect: Rect | null) => {
      cropPendingRef.current = rect;
      setCropPendingState(rect);
    };

    const unit = () => Math.max(1, sourceRef.current.w / 1200);
    const strokeWidth = () => (SIZES.find((size) => size.key === sizeKey)?.mul ?? 6) * unit();
    const currentOpacity = () => Math.max(0.1, Math.min(1, opacity / 100));

    const snapshot = (): EditorSnapshot => ({
      source: { ...sourceRef.current },
      annos: cloneAnnos(annosRef.current),
    });

    const applySnapshot = (next: EditorSnapshot) => {
      sourceRef.current = { ...next.source };
      annosRef.current = cloneAnnos(next.annos);
      draftRef.current = null;
      setCropPending(null);
      setTextDraft(null);
      bump((value) => value + 1);
    };

    const pushHistory = () => {
      undoRef.current.push(snapshot());
      if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift();
      redoRef.current = [];
    };

    const previewScale = () => {
      const source = sourceRef.current;
      return Math.min(
        1,
        PREVIEW_MAX_DIMENSION / Math.max(1, source.w),
        PREVIEW_MAX_DIMENSION / Math.max(1, source.h),
        Math.sqrt(PREVIEW_MAX_PIXELS / Math.max(1, source.w * source.h)),
      );
    };

    const render = useCallback(() => {
      const canvas = canvasRef.current;
      const bitmap = bitmapRef.current;
      if (!canvas || !bitmap) return;
      const source = sourceRef.current;
      const scale = previewScale();
      const width = Math.max(1, Math.round(source.w * scale));
      const height = Math.max(1, Math.round(source.h * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, source.x, source.y, source.w, source.h, 0, 0, width, height);
      ctx.scale(scale, scale);
      for (const anno of annosRef.current) drawAnno(ctx, anno, bitmap, source);
      const draft = draftRef.current;
      if (draft?.kind === 'crop') {
        drawCropVeil(ctx, norm(draft.from, draft.to), source.w, source.h);
      } else if (draft?.kind === 'anno') {
        drawAnno(ctx, draft.anno, bitmap, source);
      }
      if (cropPendingRef.current) drawCropVeil(ctx, cropPendingRef.current, source.w, source.h);
      ctx.restore();
    }, []);

    const scheduleRender = useCallback(() => {
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        render();
      });
    }, [render]);

    useEffect(() => {
      let cancelled = false;
      setLoaded(false);
      setLoadError('');
      createImageBitmap(blob)
        .then((bitmap) => {
          if (cancelled) {
            bitmap.close();
            return;
          }
          bitmapRef.current?.close();
          bitmapRef.current = bitmap;
          sourceRef.current = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
          annosRef.current = [];
          undoRef.current = [];
          redoRef.current = [];
          draftRef.current = null;
          setCropPending(null);
          setTextDraft(null);
          setLoaded(true);
          bump((value) => value + 1);
          requestAnimationFrame(render);
        })
        .catch(() => {
          if (!cancelled) setLoadError('This image could not be decoded.');
        });
      return () => {
        cancelled = true;
      };
    }, [blob, render]);

    useEffect(() => {
      scheduleRender();
    }, [cropPending, scheduleRender]);

    useEffect(
      () => () => {
        if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
        bitmapRef.current?.close();
        bitmapRef.current = null;
      },
      [],
    );

    const pos = (event: React.PointerEvent): Point => {
      const canvas = canvasRef.current!;
      const bounds = canvas.getBoundingClientRect();
      const source = sourceRef.current;
      return {
        x: Math.max(0, Math.min(source.w, ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * source.w)),
        y: Math.max(0, Math.min(source.h, ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * source.h)),
      };
    };

    const commitAnno = (anno: Anno) => {
      pushHistory();
      annosRef.current.push(anno);
      onEdited();
      bump((value) => value + 1);
      scheduleRender();
    };

    const undo = () => {
      const previous = undoRef.current.pop();
      if (!previous) return;
      redoRef.current.push(snapshot());
      applySnapshot(previous);
      onEdited();
      scheduleRender();
    };

    const redo = () => {
      const next = redoRef.current.pop();
      if (!next) return;
      undoRef.current.push(snapshot());
      applySnapshot(next);
      onEdited();
      scheduleRender();
    };

    const reset = () => {
      const bitmap = bitmapRef.current;
      if (!bitmap) return;
      pushHistory();
      sourceRef.current = { x: 0, y: 0, w: bitmap.width, h: bitmap.height };
      annosRef.current = [];
      draftRef.current = null;
      setCropPending(null);
      setTextDraft(null);
      onEdited();
      bump((value) => value + 1);
      scheduleRender();
    };

    const applyCrop = () => {
      const rect = cropPendingRef.current;
      if (!rect || rect.w < 8 || rect.h < 8) return;
      const rounded: Rect = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.w),
        h: Math.round(rect.h),
      };
      pushHistory();
      const source = sourceRef.current;
      sourceRef.current = {
        x: source.x + rounded.x,
        y: source.y + rounded.y,
        w: rounded.w,
        h: rounded.h,
      };
      annosRef.current = annosRef.current
        .filter((anno) => intersects(annotationBounds(anno), rounded))
        .map((anno) => shiftAnno(anno, -rounded.x, -rounded.y));
      setCropPending(null);
      onEdited();
      bump((value) => value + 1);
      scheduleRender();
    };

    const eraseAt = (point: Point) => {
      const radius = Math.max(16, strokeWidth() * 2.5);
      for (let index = annosRef.current.length - 1; index >= 0; index--) {
        if (pointNearAnno(point, annosRef.current[index], radius)) {
          pushHistory();
          annosRef.current.splice(index, 1);
          onEdited();
          bump((value) => value + 1);
          scheduleRender();
          return;
        }
      }
    };

    const onDown = (event: React.PointerEvent) => {
      if (!loaded || textDraft) return;
      const point = pos(event);
      if (tool === 'text') {
        setTextDraft(point);
        return;
      }
      if (tool === 'eraser') {
        eraseAt(point);
        return;
      }
      if (tool === 'step') {
        const number = annosRef.current.reduce((max, anno) => Math.max(max, anno.number ?? 0), 0) + 1;
        commitAnno({
          id: uid(),
          tool: 'step',
          color,
          width: strokeWidth(),
          opacity: currentOpacity(),
          from: point,
          number,
        });
        return;
      }
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      drawingRef.current = true;
      setCropPending(null);
      if (tool === 'crop') {
        draftRef.current = { kind: 'crop', from: point, to: point };
      } else if (tool === 'pen' || tool === 'highlight') {
        draftRef.current = {
          kind: 'anno',
          anno: { id: uid(), tool, color, width: strokeWidth(), opacity: currentOpacity(), points: [point] },
        };
      } else {
        draftRef.current = {
          kind: 'anno',
          anno: { id: uid(), tool, color, width: strokeWidth(), opacity: currentOpacity(), from: point, to: point },
        };
      }
      scheduleRender();
    };

    const onMove = (event: React.PointerEvent) => {
      if (!drawingRef.current || !draftRef.current) return;
      const point = pos(event);
      if (draftRef.current.kind === 'crop') draftRef.current.to = point;
      else if (draftRef.current.anno.points) draftRef.current.anno.points.push(point);
      else draftRef.current.anno.to = point;
      scheduleRender();
    };

    const onUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const draft = draftRef.current;
      draftRef.current = null;
      if (!draft) return;
      if (draft.kind === 'crop') {
        const rect = norm(draft.from, draft.to);
        if (rect.w >= 8 && rect.h >= 8) setCropPending(rect);
        scheduleRender();
        return;
      }
      const anno = draft.anno;
      const meaningful = anno.points
        ? anno.points.length > 1
        : Math.abs((anno.to?.x ?? 0) - (anno.from?.x ?? 0)) + Math.abs((anno.to?.y ?? 0) - (anno.from?.y ?? 0)) > 3;
      if (meaningful) commitAnno(anno);
      else scheduleRender();
    };

    const commitText = (value: string) => {
      if (textDraft && value.trim()) {
        commitAnno({
          id: uid(),
          tool: 'text',
          color,
          width: strokeWidth(),
          opacity: currentOpacity(),
          from: textDraft,
          text: value.trim().slice(0, 500),
        });
      }
      setTextDraft(null);
    };

    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setCropPending(null);
          setTextDraft(null);
          draftRef.current = null;
          drawingRef.current = false;
          scheduleRender();
        }
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey) {
          event.preventDefault();
          undo();
        }
        if (modifier && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
          event.preventDefault();
          redo();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
      // The handlers intentionally use refs so a new global listener is not added
      // for every pen stroke.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scheduleRender]);

    useImperativeHandle(ref, () => ({
      async exportBlob(options: ImageExportOptions = {}) {
        const bitmap = bitmapRef.current;
        if (!bitmap) throw new Error('Image not loaded yet');
        const source = sourceRef.current;
        const format = options.format ?? 'png';
        const quality = Math.max(0.5, Math.min(1, options.quality ?? 0.94));
        let outputScale = 1;
        if (options.maxPixels && source.w * source.h > options.maxPixels) {
          outputScale = Math.sqrt(options.maxPixels / (source.w * source.h));
        }
        const maxDimensionScale = Math.min(1, 16_384 / source.w, 16_384 / source.h);
        outputScale = Math.min(outputScale, maxDimensionScale);
        const width = Math.max(1, Math.round(source.w * outputScale));
        const height = Math.max(1, Math.round(source.h * outputScale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { alpha: format === 'png' || format === 'webp' })!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, source.x, source.y, source.w, source.h, 0, 0, width, height);
        ctx.save();
        ctx.scale(outputScale, outputScale);
        for (const anno of annosRef.current) drawAnno(ctx, anno, bitmap, source);
        ctx.restore();

        if (format === 'pdf') {
          const jpeg = await canvasBlob(canvas, 'image/jpeg', quality);
          return jpegToPdf(jpeg, width, height);
        }
        const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
        return canvasBlob(canvas, mime, format === 'png' ? undefined : quality);
      },
    }));

    const source = sourceRef.current;
    const scale = previewScale();
    const cssWidth = Math.max(1, Math.round(source.w * scale));
    const cssHeight = Math.max(1, Math.round(source.h * scale));
    const zoomMultiplier = zoom === 'fit' ? 1 : zoom / 100 / Math.max(scale, 0.0001);
    const displayWidth = zoom === 'fit' ? undefined : cssWidth * zoomMultiplier;
    const displayHeight = zoom === 'fit' ? undefined : cssHeight * zoomMultiplier;
    const canvas = canvasRef.current;
    const displayScale = canvas && source.w ? (canvas.getBoundingClientRect().width || cssWidth) / source.w : scale;

    const toolBtn = (value: Tool, title: string, svg: React.ReactNode) => (
      <button
        key={value}
        type="button"
        className={`grid h-9 w-9 place-items-center rounded-lg border transition ${
          tool === value ? 'border-brand bg-brand/10 text-brand' : 'border-transparent text-ink-soft hover:bg-surface-sunken'
        }`}
        onClick={() => {
          setTool(value);
          setTextDraft(null);
          setCropPending(null);
        }}
        title={title}
        aria-label={title}
      >
        {svg}
      </button>
    );

    if (loadError) {
      return <div className="grid flex-1 place-items-center p-8 text-sm text-red-500">{loadError}</div>;
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-raised px-4 py-2">
          <div className="flex flex-wrap items-center gap-0.5">
            {toolBtn('crop', 'Crop', ic('M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14'))}
            {toolBtn('pen', 'Pen', ic('M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z'))}
            {toolBtn('highlight', 'Highlighter', ic('M5 19h6L21 9l-6-6L5 13zM15 3l6 6'))}
            {toolBtn('line', 'Line', ic('M5 19L19 5'))}
            {toolBtn('arrow', 'Arrow', ic('M5 19L19 5M19 5h-8M19 5v8'))}
            {toolBtn('rect', 'Rectangle', ic('M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z'))}
            {toolBtn('ellipse', 'Ellipse', ic('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'))}
            {toolBtn('text', 'Text', ic('M4 7V4h16v3M9 20h6M12 4v16'))}
            {toolBtn('step', 'Numbered step', <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-current text-[10px] font-black text-white">1</span>)}
            {toolBtn('blur', 'Blur sensitive information', ic('M4 8c3-5 13-5 16 0M4 16c3-5 13-5 16 0'))}
            {toolBtn('pixelate', 'Pixelate sensitive information', ic('M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4zM15 15h5v5h-5z'))}
            {toolBtn('redact', 'Blackout redaction', ic('M4 7h16v10H4z'))}
            {toolBtn('eraser', 'Erase an annotation', ic('M7 20h10M5 15l9-9 5 5-9 9z'))}
          </div>
          <span className="h-6 w-px bg-line" />
          <div className="flex items-center gap-1.5">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${
                  color === value ? 'border-brand ring-2 ring-brand/40' : value === '#ffffff' ? 'border-line' : 'border-transparent'
                }`}
                style={{ background: value }}
                onClick={() => setColor(value)}
                title={value}
                aria-label={`Use ${value}`}
              />
            ))}
          </div>
          <span className="h-6 w-px bg-line" />
          <div className="flex rounded-lg border border-line p-0.5">
            {SIZES.map((size) => (
              <button
                key={size.key}
                type="button"
                className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  sizeKey === size.key ? 'bg-brand text-white' : 'text-ink-faint hover:text-ink'
                }`}
                onClick={() => setSizeKey(size.key)}
                title={`${size.label} stroke`}
              >
                {size.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs text-ink-faint">
            Opacity
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
              className="w-20 accent-brand"
            />
            <span className="w-8 tabular-nums">{opacity}%</span>
          </label>
          <span className="h-6 w-px bg-line" />
          <label className="flex items-center gap-1.5 text-xs text-ink-faint" title="Preview zoom — exports remain full resolution">
            Zoom
            <select
              className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
              value={String(zoom)}
              onChange={(event) => {
                const value = event.target.value;
                setZoom(value === 'fit' ? 'fit' : (Number(value) as 25 | 50 | 100 | 200));
              }}
            >
              <option value="fit">Fit</option>
              <option value="25">25%</option>
              <option value="50">50%</option>
              <option value="100">100%</option>
              <option value="200">200%</option>
            </select>
          </label>
          <span className="h-6 w-px bg-line" />
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={undo} disabled={!undoRef.current.length} title="Undo (Ctrl+Z)">
            ↩ Undo
          </button>
          <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={redo} disabled={!redoRef.current.length} title="Redo (Ctrl+Y)">
            ↪ Redo
          </button>
          <button
            type="button"
            className="btn-ghost px-2.5 py-1.5 text-xs hover:text-red-500"
            onClick={reset}
            disabled={!undoRef.current.length && !annosRef.current.length && sourceRef.current.x === 0 && sourceRef.current.y === 0}
            title="Discard every edit and restore the original image"
          >
            Reset
          </button>
          {tool === 'crop' && !cropPending && <span className="text-xs text-ink-faint">Drag to choose the crop area</span>}
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto p-6">
          {!loaded && <div className="absolute inset-0 grid place-items-center text-sm text-ink-faint">Preparing image…</div>}
          <div className="relative mx-auto w-fit">
            <canvas
              ref={canvasRef}
              className={`block rounded-lg border border-line bg-white shadow-card ${
                zoom === 'fit' ? 'max-h-[calc(100vh-11rem)] max-w-full' : 'max-w-none'
              } ${tool === 'text' ? 'cursor-text' : tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
              style={displayWidth ? { width: `${displayWidth}px`, height: `${displayHeight}px` } : undefined}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            {textDraft && (
              <input
                autoFocus
                className="absolute min-w-32 rounded border border-brand bg-white/95 px-1.5 py-1 font-semibold text-ink shadow-card outline-none"
                style={{
                  left: textDraft.x * displayScale,
                  top: textDraft.y * displayScale - 18,
                  fontSize: Math.max(12, strokeWidth() * 3 * displayScale),
                  color,
                }}
                placeholder="Type annotation…"
                maxLength={500}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitText((event.target as HTMLInputElement).value);
                  if (event.key === 'Escape') setTextDraft(null);
                }}
                onBlur={(event) => commitText(event.target.value)}
              />
            )}
            {cropPending && (
              <div
                className="absolute flex gap-1.5"
                style={{
                  left: Math.max(4, (cropPending.x + cropPending.w / 2) * displayScale - 60),
                  top: Math.max(4, (cropPending.y + cropPending.h) * displayScale + 8),
                }}
              >
                <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={applyCrop}>
                  ✓ Crop
                </button>
                <button type="button" className="btn-outline bg-surface-raised px-3 py-1 text-xs" onClick={() => setCropPending(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

function shiftAnno(anno: Anno, dx: number, dy: number): Anno {
  return {
    ...anno,
    points: anno.points?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    from: anno.from ? { x: anno.from.x + dx, y: anno.from.y + dy } : undefined,
    to: anno.to ? { x: anno.to.x + dx, y: anno.to.y + dy } : undefined,
  };
}

function annotationBounds(anno: Anno): Rect {
  if (anno.points?.length) {
    const xs = anno.points.map((point) => point.x);
    const ys = anno.points.map((point) => point.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      h: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    };
  }
  if (anno.from && anno.to) return norm(anno.from, anno.to);
  if (anno.from) {
    const radius = anno.tool === 'step' ? Math.max(14, anno.width * 3) : Math.max(12, anno.width * 4);
    return { x: anno.from.x - radius, y: anno.from.y - radius, w: radius * 2, h: radius * 2 };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x + a.w >= b.x && b.x + b.w >= a.x && a.y + a.h >= b.y && b.y + b.h >= a.y;
}

function pointNearAnno(point: Point, anno: Anno, radius: number): boolean {
  const bounds = annotationBounds(anno);
  return (
    point.x >= bounds.x - radius &&
    point.x <= bounds.x + bounds.w + radius &&
    point.y >= bounds.y - radius &&
    point.y <= bounds.y + bounds.h + radius
  );
}

function drawAnno(ctx: CanvasRenderingContext2D, anno: Anno, bitmap: ImageBitmap, source: Rect) {
  ctx.save();
  ctx.globalAlpha = anno.opacity;
  ctx.strokeStyle = anno.color;
  ctx.fillStyle = anno.color;
  ctx.lineWidth = anno.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (anno.tool) {
    case 'pen':
    case 'highlight': {
      if (!anno.points || anno.points.length < 2) break;
      if (anno.tool === 'highlight') {
        ctx.globalAlpha = Math.min(0.45, anno.opacity * 0.45);
        ctx.lineWidth = anno.width * 3.5;
        ctx.lineCap = 'butt';
      }
      ctx.beginPath();
      ctx.moveTo(anno.points[0].x, anno.points[0].y);
      for (const point of anno.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
      break;
    }
    case 'line': {
      if (!anno.from || !anno.to) break;
      ctx.beginPath();
      ctx.moveTo(anno.from.x, anno.from.y);
      ctx.lineTo(anno.to.x, anno.to.y);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      if (!anno.from || !anno.to) break;
      const head = Math.max(12, anno.width * 3.5);
      const angle = Math.atan2(anno.to.y - anno.from.y, anno.to.x - anno.from.x);
      ctx.beginPath();
      ctx.moveTo(anno.from.x, anno.from.y);
      ctx.lineTo(anno.to.x, anno.to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(anno.to.x, anno.to.y);
      ctx.lineTo(anno.to.x - head * Math.cos(angle - Math.PI / 6), anno.to.y - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(anno.to.x - head * Math.cos(angle + Math.PI / 6), anno.to.y - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'rect': {
      if (!anno.from || !anno.to) break;
      const rect = norm(anno.from, anno.to);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      break;
    }
    case 'ellipse': {
      if (!anno.from || !anno.to) break;
      const rect = norm(anno.from, anno.to);
      ctx.beginPath();
      ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w / 2, rect.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'text': {
      if (!anno.from || !anno.text) break;
      const fontSize = Math.max(14, anno.width * 4);
      ctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.lineWidth = Math.max(2, fontSize / 8);
      ctx.strokeStyle = anno.color === '#ffffff' ? 'rgba(0,0,0,.8)' : 'rgba(255,255,255,.9)';
      ctx.strokeText(anno.text, anno.from.x, anno.from.y);
      ctx.fillStyle = anno.color;
      ctx.fillText(anno.text, anno.from.x, anno.from.y);
      break;
    }
    case 'step': {
      if (!anno.from) break;
      const radius = Math.max(14, anno.width * 3);
      ctx.beginPath();
      ctx.arc(anno.from.x, anno.from.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2, anno.width / 2);
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(radius * 1.15)}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(anno.number ?? 1), anno.from.x, anno.from.y + 1);
      break;
    }
    case 'redact': {
      if (!anno.from || !anno.to) break;
      const rect = norm(anno.from, anno.to);
      ctx.globalAlpha = 1;
      ctx.fillStyle = anno.color === '#ffffff' ? '#000' : anno.color;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      break;
    }
    case 'blur': {
      if (!anno.from || !anno.to) break;
      const rect = norm(anno.from, anno.to);
      if (rect.w < 3 || rect.h < 3) break;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      ctx.filter = `blur(${Math.max(4, anno.width * 2)}px)`;
      const pad = Math.max(8, anno.width * 4);
      ctx.drawImage(
        bitmap,
        source.x + Math.max(0, rect.x - pad),
        source.y + Math.max(0, rect.y - pad),
        Math.min(source.w, rect.w + pad * 2),
        Math.min(source.h, rect.h + pad * 2),
        Math.max(0, rect.x - pad),
        Math.max(0, rect.y - pad),
        Math.min(source.w, rect.w + pad * 2),
        Math.min(source.h, rect.h + pad * 2),
      );
      ctx.restore();
      break;
    }
    case 'pixelate': {
      if (!anno.from || !anno.to) break;
      const rect = norm(anno.from, anno.to);
      if (rect.w < 3 || rect.h < 3) break;
      const cell = Math.max(8, Math.round(anno.width * 2.5));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(rect.w / cell));
      small.height = Math.max(1, Math.round(rect.h / cell));
      const smallContext = small.getContext('2d')!;
      smallContext.drawImage(bitmap, source.x + rect.x, source.y + rect.y, rect.w, rect.h, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, small.width, small.height, rect.x, rect.y, rect.w, rect.h);
      ctx.imageSmoothingEnabled = true;
      break;
    }
  }
  ctx.restore();
}

function drawCropVeil(ctx: CanvasRenderingContext2D, rect: Rect, width: number, height: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.52)';
  ctx.fillRect(0, 0, width, rect.y);
  ctx.fillRect(0, rect.y, rect.x, rect.h);
  ctx.fillRect(rect.x + rect.w, rect.y, width - rect.x - rect.w, rect.h);
  ctx.fillRect(0, rect.y + rect.h, width, height - rect.y - rect.h);
  ctx.strokeStyle = '#6d5dfc';
  ctx.lineWidth = Math.max(2, width / 800);
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

async function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new Error('The image is too large to export in that format. Try JPEG or WebP.');
  return blob;
}

async function jpegToPdf(jpeg: Blob, width: number, height: number): Promise<Blob> {
  const image = new Uint8Array(await jpeg.arrayBuffer());
  const encoder = new TextEncoder();
  const chunks: ArrayBuffer[] = [];
  const offsets: number[] = [0];
  let length = 0;
  const push = (value: string | Uint8Array) => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    chunks.push(copy.buffer);
    length += copy.byteLength;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%Keepsake\n');
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  object(3, () =>
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
  );
  object(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`);
    push(image);
    push('\nendstream');
  });
  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
  object(5, () => push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`));

  const xref = length;
  push('xref\n0 6\n0000000000 65535 f \n');
  for (let id = 1; id <= 5; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

function ic(path: string) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}
