import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Canvas annotation editor for screenshots: crop, pen, highlighter, arrow,
// rectangle, ellipse, text, and pixelate (redact), with undo/redo and reset.
// The canvas holds the image at FULL resolution (CSS scales it to fit), so
// exports stay exactly as sharp as the capture itself.

export interface ImageEditorHandle {
  exportBlob(forcePng?: boolean): Promise<Blob>;
}

type Tool = 'crop' | 'pen' | 'highlight' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'blur';

interface Anno {
  tool: Exclude<Tool, 'crop'>;
  color: string;
  width: number; // stroke width in image pixels
  points?: { x: number; y: number }[]; // pen / highlight
  from?: { x: number; y: number }; // arrow / rect / ellipse / blur
  to?: { x: number; y: number };
  text?: string; // text tool: from = anchor
}

// Undo units: one annotation, or one crop (undo restores the pre-crop bitmap).
type Op = { kind: 'anno'; anno: Anno } | { kind: 'crop'; prevBase: ImageBitmap; rect: Rect };
type Rect = { x: number; y: number; w: number; h: number };

const COLORS = ['#ef4444', '#f59e0b', '#facc15', '#22c55e', '#3b82f6', '#111827', '#ffffff'];
const SIZES: { key: string; label: string; mul: number }[] = [
  { key: 's', label: 'S', mul: 3 },
  { key: 'm', label: 'M', mul: 6 },
  { key: 'l', label: 'L', mul: 12 },
];

const norm = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x),
  h: Math.abs(a.y - b.y),
});

export const ImageEditor = forwardRef<ImageEditorHandle, { blob: Blob; onEdited: () => void }>(
  function ImageEditor({ blob, onEdited }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const baseRef = useRef<ImageBitmap | null>(null);
    const originalRef = useRef<Blob>(blob);
    const annosRef = useRef<Anno[]>([]);
    const undoRef = useRef<Op[]>([]);
    const redoRef = useRef<Op[]>([]);
    const draftRef = useRef<Anno | null>(null);
    const [tool, setTool] = useState<Tool>('pen');
    const [color, setColor] = useState(COLORS[0]);
    const [sizeKey, setSizeKey] = useState('m');
    const [loaded, setLoaded] = useState(false);
    const [cropPending, setCropPending] = useState<Rect | null>(null);
    const [textDraft, setTextDraft] = useState<{ x: number; y: number } | null>(null);
    const [, bump] = useState(0); // re-render for toolbar enable/disable states
    const drawingRef = useRef(false);

    // Stroke widths track the image resolution so annotations look the same on
    // a 1440px viewport shot and a 2880px retina full-page monster.
    const unit = () => Math.max(1, (baseRef.current?.width ?? 1200) / 1200);
    const strokeWidth = () => (SIZES.find((s) => s.key === sizeKey)?.mul ?? 6) * unit();

    const render = useCallback(() => {
      const canvas = canvasRef.current;
      const base = baseRef.current;
      if (!canvas || !base) return;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0);
      for (const a of annosRef.current) drawAnno(ctx, a, base);
      const draft = draftRef.current;
      if (draft) {
        // A crop-in-progress previews as the dim veil, not as a drawn shape.
        if ((draft.tool as string) === 'crop' && draft.from && draft.to) {
          drawCropVeil(ctx, norm(draft.from, draft.to), canvas.width, canvas.height);
        } else {
          drawAnno(ctx, draft, base);
        }
      }
      if (cropPending) drawCropVeil(ctx, cropPending, canvas.width, canvas.height);
    }, [cropPending]);

    // (Re)load the bitmap when the source blob changes.
    useEffect(() => {
      let dead = false;
      originalRef.current = blob;
      createImageBitmap(blob).then((bmp) => {
        if (dead) return;
        baseRef.current = bmp;
        const canvas = canvasRef.current!;
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        setLoaded(true);
        render();
      });
      return () => {
        dead = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blob]);

    useEffect(() => {
      render();
    }, [render, cropPending]);

    const pos = (e: React.PointerEvent) => {
      const canvas = canvasRef.current!;
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(canvas.width, (e.clientX - r.left) * (canvas.width / r.width))),
        y: Math.max(0, Math.min(canvas.height, (e.clientY - r.top) * (canvas.height / r.height))),
      };
    };

    const commit = (op: Op) => {
      if (op.kind === 'anno') annosRef.current.push(op.anno);
      undoRef.current.push(op);
      redoRef.current = [];
      onEdited();
      bump((n) => n + 1);
      render();
    };

    const undo = () => {
      const op = undoRef.current.pop();
      if (!op) return;
      if (op.kind === 'anno') {
        annosRef.current = annosRef.current.filter((a) => a !== op.anno);
      } else {
        // Restore the pre-crop bitmap and shift annotations back out.
        const canvas = canvasRef.current!;
        baseRef.current = op.prevBase;
        canvas.width = op.prevBase.width;
        canvas.height = op.prevBase.height;
        shiftAnnos(annosRef.current, op.rect.x, op.rect.y);
      }
      redoRef.current.push(op);
      onEdited();
      bump((n) => n + 1);
      render();
    };

    const applyCropRect = async (rect: Rect): Promise<Op | null> => {
      const base = baseRef.current!;
      const r = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.w),
        h: Math.round(rect.h),
      };
      if (r.w < 8 || r.h < 8) return null;
      const off = document.createElement('canvas');
      off.width = r.w;
      off.height = r.h;
      off.getContext('2d')!.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      const bmp = await createImageBitmap(off);
      const op: Op = { kind: 'crop', prevBase: base, rect: r };
      baseRef.current = bmp;
      const canvas = canvasRef.current!;
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      shiftAnnos(annosRef.current, -r.x, -r.y);
      return op;
    };

    const redo = async () => {
      const op = redoRef.current.pop();
      if (!op) return;
      if (op.kind === 'anno') {
        annosRef.current.push(op.anno);
        undoRef.current.push(op);
      } else {
        const applied = await applyCropRect(op.rect);
        if (applied) undoRef.current.push(applied);
      }
      onEdited();
      bump((n) => n + 1);
      render();
    };

    const reset = async () => {
      const bmp = await createImageBitmap(originalRef.current);
      baseRef.current = bmp;
      const canvas = canvasRef.current!;
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      annosRef.current = [];
      undoRef.current = [];
      redoRef.current = [];
      setCropPending(null);
      draftRef.current = null;
      onEdited();
      bump((n) => n + 1);
      render();
    };

    // ---- pointer handlers ----------------------------------------------------

    const onDown = (e: React.PointerEvent) => {
      if (!loaded || textDraft) return;
      const p = pos(e);
      if (tool === 'text') {
        setTextDraft(p);
        return;
      }
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drawingRef.current = true;
      setCropPending(null);
      if (tool === 'pen' || tool === 'highlight') {
        draftRef.current = { tool, color, width: strokeWidth(), points: [p] };
      } else {
        draftRef.current = { tool: tool as Anno['tool'], color, width: strokeWidth(), from: p, to: p };
      }
      render();
    };

    const onMove = (e: React.PointerEvent) => {
      if (!drawingRef.current || !draftRef.current) return;
      const p = pos(e);
      if (draftRef.current.points) draftRef.current.points.push(p);
      else draftRef.current.to = p;
      render();
    };

    const onUp = () => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      const draft = draftRef.current;
      draftRef.current = null;
      if (!draft) return;
      if (tool === 'crop') {
        const rect = draft.from && draft.to ? norm(draft.from, draft.to) : null;
        if (rect && rect.w >= 8 && rect.h >= 8) setCropPending(rect);
        else render();
        return;
      }
      // Ignore accidental zero-length marks.
      const span = draft.points
        ? draft.points.length > 1
        : Math.abs((draft.to?.x ?? 0) - (draft.from?.x ?? 0)) + Math.abs((draft.to?.y ?? 0) - (draft.from?.y ?? 0)) > 3;
      if (span) commit({ kind: 'anno', anno: draft });
      else render();
    };

    const commitText = (value: string) => {
      if (textDraft && value.trim()) {
        commit({
          kind: 'anno',
          anno: { tool: 'text', color, width: strokeWidth(), from: textDraft, text: value.trim() },
        });
      }
      setTextDraft(null);
    };

    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        // Typing in an input (e.g. the text-annotation box) owns its own
        // Ctrl+Z/Escape — hijacking them here removed the previous canvas
        // annotation while the field did its native undo.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.key === 'Escape') {
          setCropPending(null);
          setTextDraft(null);
          draftRef.current = null;
          drawingRef.current = false;
          render();
        }
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        }
        if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
          e.preventDefault();
          redo();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [render]);

    useImperativeHandle(ref, () => ({
      async exportBlob(forcePng = false) {
        const base = baseRef.current;
        if (!base) throw new Error('Image not loaded yet');
        const out = document.createElement('canvas');
        out.width = base.width;
        out.height = base.height;
        const ctx = out.getContext('2d')!;
        ctx.drawImage(base, 0, 0);
        for (const a of annosRef.current) drawAnno(ctx, a, base);
        // PNG for normal sizes; JPEG for monster full-page canvases (PNG encode
        // of >50M pixels routinely OOMs). Clipboard requires PNG regardless.
        const usePng = forcePng || out.width * out.height <= 50_000_000;
        const b = await new Promise<Blob | null>((r) =>
          out.toBlob(r, usePng ? 'image/png' : 'image/jpeg', usePng ? undefined : 0.97),
        );
        if (!b) throw new Error('Could not export the image (it may be too large)');
        return b;
      },
    }));

    // Scale the floating text input to match where the text will land.
    const canvas = canvasRef.current;
    const cssScale = canvas && canvas.width ? (canvas.getBoundingClientRect().width || canvas.width) / canvas.width : 1;

    const toolBtn = (t: Tool, title: string, svg: React.ReactNode) => (
      <button
        key={t}
        className={`grid h-9 w-9 place-items-center rounded-lg border transition ${
          tool === t ? 'border-brand bg-brand/10 text-brand' : 'border-transparent text-ink-soft hover:bg-surface-sunken'
        }`}
        onClick={() => {
          setTool(t);
          setTextDraft(null);
        }}
        title={title}
      >
        {svg}
      </button>
    );

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-raised px-4 py-2">
          <div className="flex items-center gap-0.5">
            {toolBtn('crop', 'Crop', ic('M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14'))}
            {toolBtn('pen', 'Pen', ic('M12 19l7-7 3 3-7 7-3-3zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5zM2 2l7.586 7.586M11 11a2 2 0 1 0 0 .01'))}
            {toolBtn('highlight', 'Highlighter', ic('M9 11l-6 6v3h9l3-3M22 12l-4.586 4.586a2 2 0 0 1-2.828 0l-5.172-5.172a2 2 0 0 1 0-2.828L14 4'))}
            {toolBtn('arrow', 'Arrow', ic('M5 19L19 5M19 5h-8M19 5v8'))}
            {toolBtn('rect', 'Rectangle', ic('M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z'))}
            {toolBtn('ellipse', 'Ellipse', ic('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'))}
            {toolBtn('text', 'Text', ic('M4 7V4h16v3M9 20h6M12 4v16'))}
            {toolBtn('blur', 'Pixelate (hide sensitive info)', ic('M4 4h4v4H4zM10 4h4v4h-4zM16 4h4v4h-4zM4 10h4v4H4zM16 10h4v4h-4zM4 16h4v4H4zM10 16h4v4h-4zM16 16h4v4h-4z'))}
          </div>
          <span className="h-6 w-px bg-line" />
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`h-6 w-6 rounded-full border-2 transition hover:scale-110 ${
                  color === c ? 'border-brand ring-2 ring-brand/40' : c === '#ffffff' ? 'border-line' : 'border-transparent'
                }`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                title={c}
              />
            ))}
          </div>
          <span className="h-6 w-px bg-line" />
          <div className="flex rounded-lg border border-line p-0.5">
            {SIZES.map((s) => (
              <button
                key={s.key}
                className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  sizeKey === s.key ? 'bg-brand text-white' : 'text-ink-faint hover:text-ink'
                }`}
                onClick={() => setSizeKey(s.key)}
                title={`${s.label} stroke`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="h-6 w-px bg-line" />
          <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={undo} disabled={!undoRef.current.length} title="Undo (Ctrl+Z)">
            ↩ Undo
          </button>
          <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={redo} disabled={!redoRef.current.length} title="Redo (Ctrl+Y)">
            ↪ Redo
          </button>
          <button
            className="btn-ghost px-2.5 py-1.5 text-xs hover:text-red-500"
            onClick={reset}
            disabled={!undoRef.current.length && !redoRef.current.length}
            title="Discard every edit and restore the original capture"
          >
            Reset
          </button>
          {tool === 'crop' && !cropPending && (
            <span className="text-xs text-ink-faint">Drag to choose the crop area</span>
          )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto p-6">
          <div className="relative mx-auto w-fit">
            <canvas
              ref={canvasRef}
              className={`block max-w-full rounded-lg border border-line bg-white shadow-card ${
                tool === 'text' ? 'cursor-text' : 'cursor-crosshair'
              }`}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            {textDraft && (
              <input
                autoFocus
                className="absolute rounded border border-brand bg-white/95 px-1 font-semibold text-ink outline-none"
                style={{
                  left: textDraft.x * cssScale,
                  top: textDraft.y * cssScale - 14,
                  fontSize: Math.max(12, strokeWidth() * 4 * cssScale),
                  color,
                }}
                placeholder="Type…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitText((e.target as HTMLInputElement).value);
                  if (e.key === 'Escape') setTextDraft(null);
                }}
                onBlur={(e) => commitText(e.target.value)}
              />
            )}
            {cropPending && (
              <div
                className="absolute flex gap-1.5"
                style={{
                  left: (cropPending.x + cropPending.w / 2) * cssScale - 60,
                  top: Math.max(4, (cropPending.y + cropPending.h) * cssScale + 8),
                }}
              >
                <button
                  className="btn-primary px-3 py-1 text-xs"
                  onClick={async () => {
                    const op = await applyCropRect(cropPending);
                    setCropPending(null);
                    if (op) {
                      undoRef.current.push(op);
                      redoRef.current = [];
                      onEdited();
                      bump((n) => n + 1);
                    }
                    render();
                  }}
                >
                  ✓ Crop
                </button>
                <button className="btn-outline bg-surface-raised px-3 py-1 text-xs" onClick={() => setCropPending(null)}>
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

function shiftAnnos(annos: Anno[], dx: number, dy: number) {
  for (const a of annos) {
    a.points = a.points?.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    if (a.from) a.from = { x: a.from.x + dx, y: a.from.y + dy };
    if (a.to) a.to = { x: a.to.x + dx, y: a.to.y + dy };
  }
}

function drawAnno(ctx: CanvasRenderingContext2D, a: Anno, base: ImageBitmap) {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (a.tool) {
    case 'pen':
    case 'highlight': {
      if (!a.points || a.points.length < 2) break;
      if (a.tool === 'highlight') {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = a.width * 3.5;
        ctx.lineCap = 'butt';
      }
      ctx.beginPath();
      ctx.moveTo(a.points[0].x, a.points[0].y);
      for (const p of a.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      break;
    }
    case 'arrow': {
      if (!a.from || !a.to) break;
      const head = Math.max(12, a.width * 3.5);
      const ang = Math.atan2(a.to.y - a.from.y, a.to.x - a.from.x);
      ctx.beginPath();
      ctx.moveTo(a.from.x, a.from.y);
      ctx.lineTo(a.to.x, a.to.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(a.to.x, a.to.y);
      ctx.lineTo(a.to.x - head * Math.cos(ang - Math.PI / 6), a.to.y - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(a.to.x - head * Math.cos(ang + Math.PI / 6), a.to.y - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'rect': {
      if (!a.from || !a.to) break;
      const r = norm(a.from, a.to);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      break;
    }
    case 'ellipse': {
      if (!a.from || !a.to) break;
      const r = norm(a.from, a.to);
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'text': {
      if (!a.from || !a.text) break;
      const size = Math.max(14, a.width * 4);
      ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      // Halo so the label stays readable on any background.
      ctx.lineWidth = Math.max(2, size / 8);
      ctx.strokeStyle = a.color === '#ffffff' ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.85)';
      ctx.strokeText(a.text, a.from.x, a.from.y);
      ctx.fillText(a.text, a.from.x, a.from.y);
      break;
    }
    case 'blur': {
      if (!a.from || !a.to) break;
      const r = norm(a.from, a.to);
      if (r.w < 4 || r.h < 4) break;
      // Pixelate: squash the region down, stretch it back up with smoothing off.
      const cell = Math.max(8, Math.round(a.width * 2.5));
      const small = document.createElement('canvas');
      small.width = Math.max(1, Math.round(r.w / cell));
      small.height = Math.max(1, Math.round(r.h / cell));
      const sctx = small.getContext('2d')!;
      sctx.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, small.width, small.height, r.x, r.y, r.w, r.h);
      break;
    }
  }
  ctx.restore();
}

// Dim everything outside the pending crop rect.
function drawCropVeil(ctx: CanvasRenderingContext2D, r: Rect, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, w, r.y);
  ctx.fillRect(0, r.y, r.x, r.h);
  ctx.fillRect(r.x + r.w, r.y, w - r.x - r.w, r.h);
  ctx.fillRect(0, r.y + r.h, w, h - r.y - r.h);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = Math.max(2, w / 800);
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

// Tiny inline stroke icon (the shared Icon set has no editor glyphs).
function ic(d: string) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
