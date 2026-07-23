// Injected with chrome.scripting.executeScript. Keep this function completely
// self-contained: it cannot close over imports when Chrome serializes it.
export function selectCaptureRegion(mode: 'region' | 'element'): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
} | null> {
  return new Promise((resolve) => {
    const html = document.documentElement;
    const viewportWidth = html.clientWidth || window.innerWidth;
    const viewportHeight = html.clientHeight || window.innerHeight;
    const overlay = document.createElement('div');
    const shade = document.createElement('div');
    const box = document.createElement('div');
    const hint = document.createElement('div');

    overlay.id = '__keepsake_capture_selector__';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;touch-action:none;';
    shade.style.cssText = 'position:absolute;inset:0;background:rgba(10,15,25,.18);backdrop-filter:saturate(.8);';
    box.style.cssText = 'position:absolute;display:none;border:2px solid #4f7cff;background:rgba(79,124,255,.08);box-shadow:0 0 0 99999px rgba(0,0,0,.20);pointer-events:none;';
    hint.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:9px 14px;border:1px solid rgba(255,255,255,.15);border-radius:999px;background:rgba(18,20,30,.92);color:white;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap;';
    hint.textContent = mode === 'element' ? 'Click an element to capture it · Esc to cancel' : 'Drag over the area to capture · Esc to cancel';
    overlay.append(shade, box, hint);
    document.documentElement.appendChild(overlay);

    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
    const showRect = (x: number, y: number, width: number, height: number) => {
      box.style.display = 'block';
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${Math.max(0, width)}px`;
      box.style.height = `${Math.max(0, height)}px`;
    };
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
    };
    const finish = (rect: { x: number; y: number; width: number; height: number } | null) => {
      cleanup();
      // Two frames guarantee Chrome captures after the selector disappears.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect ? { ...rect, viewportWidth, viewportHeight } : null)));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(null);
    };
    window.addEventListener('keydown', onKey, true);

    if (mode === 'element') {
      let current: Element | null = null;
      const move = (event: PointerEvent) => {
        overlay.style.pointerEvents = 'none';
        const target = document.elementFromPoint(event.clientX, event.clientY);
        overlay.style.pointerEvents = '';
        if (!target || target === overlay || overlay.contains(target)) return;
        current = target;
        const rect = target.getBoundingClientRect();
        const x = clamp(rect.left, 0, viewportWidth);
        const y = clamp(rect.top, 0, viewportHeight);
        showRect(x, y, Math.min(rect.right, viewportWidth) - x, Math.min(rect.bottom, viewportHeight) - y);
      };
      overlay.addEventListener('pointermove', move);
      overlay.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!current) return;
        const rect = current.getBoundingClientRect();
        const x = clamp(rect.left, 0, viewportWidth);
        const y = clamp(rect.top, 0, viewportHeight);
        const width = Math.min(rect.right, viewportWidth) - x;
        const height = Math.min(rect.bottom, viewportHeight) - y;
        finish(width >= 4 && height >= 4 ? { x, y, width, height } : null);
      });
      return;
    }

    let start: { x: number; y: number } | null = null;
    overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      start = { x: clamp(event.clientX, 0, viewportWidth), y: clamp(event.clientY, 0, viewportHeight) };
      overlay.setPointerCapture(event.pointerId);
      showRect(start.x, start.y, 0, 0);
      event.preventDefault();
    });
    overlay.addEventListener('pointermove', (event) => {
      if (!start) return;
      const x2 = clamp(event.clientX, 0, viewportWidth);
      const y2 = clamp(event.clientY, 0, viewportHeight);
      showRect(Math.min(start.x, x2), Math.min(start.y, y2), Math.abs(x2 - start.x), Math.abs(y2 - start.y));
    });
    overlay.addEventListener('pointerup', (event) => {
      if (!start) return;
      const x2 = clamp(event.clientX, 0, viewportWidth);
      const y2 = clamp(event.clientY, 0, viewportHeight);
      const rect = {
        x: Math.min(start.x, x2),
        y: Math.min(start.y, y2),
        width: Math.abs(x2 - start.x),
        height: Math.abs(y2 - start.y),
      };
      start = null;
      finish(rect.width >= 8 && rect.height >= 8 ? rect : null);
    });
  });
}
