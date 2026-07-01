// Full-page screenshot script (ported from CaptureCraft). Injected into the
// target tab via chrome.scripting.executeScript, so it MUST stay fully
// self-contained: no closures over module imports, everything declared inside.
//
// Strategy: measure the full document, hide fixed/sticky elements (they'd
// repeat in every tile), scroll tile-by-tile letting layout settle, ask the
// background for a captureVisibleTab shot per tile (the page itself can't
// screenshot), and stitch the tiles onto one canvas sized to the full page.
// A small floating bar shows progress and lets the user stop early (the
// partial capture is kept). Returns a PNG data URL (JPEG for huge pages).

export function captureFullPageScript(): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const body = document.body;
      const html = document.documentElement;
      const fullHeight = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
      const fullWidth = Math.max(body.scrollWidth, body.offsetWidth, html.clientWidth, html.scrollWidth, html.offsetWidth);

      const originalScrollX = window.scrollX;
      const originalScrollY = window.scrollY;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const cols = Math.ceil(fullWidth / viewportWidth);
      const rows = Math.ceil(fullHeight / viewportHeight);
      // Canvas hard limits (Chrome): 16384px per side, ~268M pixels total.
      const MAX_CANVAS_DIMENSION = 16384;
      const MAX_CANVAS_PIXELS = 268435456;

      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // rAF + macrotask flush so the frame we capture is fully rendered.
      const waitForRender = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

      // Scroll and wait until the page actually lands there (smooth-scroll
      // pages and lazy layout shifts need a few attempts).
      const settleToPosition = async (targetX: number, targetY: number) => {
        for (const pause of [180, 320, 520]) {
          window.scrollTo(targetX, targetY);
          await delay(pause);
          await waitForRender();
          if (Math.abs(window.scrollX - targetX) <= 1 && Math.abs(window.scrollY - targetY) <= 1) return;
        }
      };

      // Give lazy-loaded images in the viewport a moment to finish (max 2s).
      const waitForImages = async () => {
        const visible: HTMLImageElement[] = [];
        for (const img of Array.from(document.querySelectorAll('img'))) {
          if (img.complete) continue;
          const rect = img.getBoundingClientRect();
          if (rect.bottom >= 0 && rect.top <= viewportHeight && rect.right >= 0 && rect.left <= viewportWidth) {
            visible.push(img);
          }
        }
        if (visible.length) {
          await Promise.race([
            Promise.all(
              visible.map(
                (img) =>
                  new Promise<void>((r) => {
                    if (img.complete) return r();
                    img.addEventListener('load', () => r(), { once: true });
                    img.addEventListener('error', () => r(), { once: true });
                  }),
              ),
            ),
            delay(2000),
          ]);
        }
      };

      // Sticky headers / fixed toolbars would repeat in every tile — hide them
      // for the whole capture and restore afterwards.
      const fixedEls: { el: HTMLElement; orig: string }[] = [];
      let stopBar: HTMLElement | null = null;
      const hideFixedElements = () => {
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
        let el = walker.currentNode as HTMLElement | null;
        while (el) {
          if (!(stopBar && (el === stopBar || stopBar.contains(el)))) {
            const style = getComputedStyle(el);
            if (style.position === 'fixed' || style.position === 'sticky') {
              fixedEls.push({ el, orig: el.style.cssText });
              el.style.setProperty('visibility', 'hidden', 'important');
            }
          }
          el = walker.nextNode() as HTMLElement | null;
        }
      };
      const restoreFixedElements = () => {
        for (const { el, orig } of fixedEls) el.style.cssText = orig;
        fixedEls.length = 0;
      };

      // One tile: background does the actual captureVisibleTab (and paces
      // itself under Chrome's ~2 captures/second quota).
      const captureViewport = async (): Promise<string | null> => {
        if (stopBar) {
          stopBar.style.visibility = 'hidden';
          stopBar.style.pointerEvents = 'none';
          await waitForRender();
        }
        try {
          return await new Promise((res) => {
            chrome.runtime.sendMessage({ type: 'KS_CAPTURE_VIEWPORT' }, (response) => {
              res(response?.dataUrl || null);
            });
          });
        } finally {
          if (stopBar) {
            stopBar.style.visibility = '';
            stopBar.style.pointerEvents = '';
          }
        }
      };

      // PNG when the canvas is a sane size, JPEG for monsters (PNG encode of
      // >50M pixels routinely OOMs the tab).
      const exportCanvas = (targetCanvas: HTMLCanvasElement): string => {
        const totalPixels = targetCanvas.width * targetCanvas.height;
        let output: string | null = null;
        if (totalPixels <= 50000000) {
          try {
            output = targetCanvas.toDataURL('image/png');
          } catch {
            output = null;
          }
        }
        if (!output || output === 'data:,' || output.length < 128 || totalPixels > 50000000) {
          output = targetCanvas.toDataURL('image/jpeg', 0.95);
        }
        return output;
      };

      (async () => {
        let styleTag: HTMLStyleElement | null = null;
        try {
          let abortCapture = false;
          let maxCapturedY = 0;

          stopBar = document.createElement('div');
          stopBar.id = '__keepsake_capture_bar__';
          stopBar.innerHTML = `
            <span id="__ks_progress__">Preparing capture…</span>
            <button id="__ks_stop_btn__">✕ Stop</button>
          `;
          stopBar.style.cssText = `
            position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
            z-index: 2147483647; display: flex; align-items: center; gap: 12px;
            background: rgba(20,20,30,0.85); backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.12); border-radius: 12px;
            padding: 10px 18px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          `;
          styleTag = document.createElement('style');
          styleTag.textContent = `
            #__ks_progress__ { color: rgba(255,255,255,0.75); font-size: 13px; font-weight: 500; white-space: nowrap; }
            #__ks_stop_btn__ {
              background: rgba(248,113,113,0.2); border: 1px solid rgba(248,113,113,0.4);
              color: #f87171; font-size: 12px; font-weight: 600; padding: 5px 14px;
              border-radius: 8px; cursor: pointer; white-space: nowrap;
            }
            #__ks_stop_btn__:hover { background: rgba(248,113,113,0.35); }
          `;
          document.head.appendChild(styleTag);
          document.body.appendChild(stopBar);
          const progressEl = document.getElementById('__ks_progress__');
          document.getElementById('__ks_stop_btn__')!.addEventListener('click', () => {
            abortCapture = true;
          });

          const totalTiles = rows * cols;
          let tilesDone = 0;

          hideFixedElements();

          // First tile also tells us the real capture scale (devicePixelRatio).
          await settleToPosition(0, 0);
          await waitForRender();
          await waitForImages();
          const firstData = await captureViewport();
          if (!firstData) throw new Error('Failed to capture first viewport');
          const tempImg = new Image();
          await new Promise((r) => {
            tempImg.onload = r;
            tempImg.src = firstData;
          });
          const rawScale = tempImg.width / viewportWidth;
          const maxScaleByDimension = Math.min(
            MAX_CANVAS_DIMENSION / (fullWidth * rawScale),
            MAX_CANVAS_DIMENSION / (fullHeight * rawScale),
            1,
          );
          const maxScaleByPixels = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (fullWidth * rawScale * (fullHeight * rawScale))));
          const exportScale = rawScale * Math.min(maxScaleByDimension, maxScaleByPixels, 1);

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(fullWidth * exportScale));
          canvas.height = Math.max(1, Math.floor(fullHeight * exportScale));
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingEnabled = false;

          ctx.drawImage(
            tempImg,
            0, 0, tempImg.width, tempImg.height,
            0, 0, Math.floor(tempImg.width * (exportScale / rawScale)), Math.floor(tempImg.height * (exportScale / rawScale)),
          );
          maxCapturedY = Math.floor(viewportHeight * exportScale);
          tilesDone = 1;
          if (progressEl) progressEl.textContent = `Capturing tile ${tilesDone} / ${totalTiles}…`;

          for (let row = 0; row < rows && !abortCapture; row++) {
            for (let col = 0; col < cols && !abortCapture; col++) {
              if (row === 0 && col === 0) continue;
              await settleToPosition(col * viewportWidth, row * viewportHeight);
              await waitForRender();
              await waitForImages();
              const data = await captureViewport();
              if (!data) continue;
              const img = new Image();
              await new Promise((r) => {
                img.onload = r;
                img.src = data;
              });
              // Use the real scroll position — the last row/column clamps at
              // the page edge, so tiles there intentionally overlap.
              const drawX = Math.max(0, Math.floor(window.scrollX * exportScale));
              const drawY = Math.max(0, Math.floor(window.scrollY * exportScale));
              const drawWidth = Math.max(1, Math.floor(img.width * (exportScale / rawScale)));
              const drawHeight = Math.max(1, Math.floor(img.height * (exportScale / rawScale)));
              ctx.drawImage(img, 0, 0, img.width, img.height, drawX, drawY, drawWidth, drawHeight);
              maxCapturedY = Math.max(maxCapturedY, drawY + drawHeight);
              tilesDone++;
              if (progressEl) progressEl.textContent = `Capturing tile ${tilesDone} / ${totalTiles}…`;
            }
          }

          if (abortCapture && maxCapturedY < canvas.height) {
            // Stopped early — return what we have instead of a mostly-blank page.
            const trimmed = document.createElement('canvas');
            trimmed.width = canvas.width;
            trimmed.height = maxCapturedY;
            trimmed.getContext('2d')!.drawImage(canvas, 0, 0, canvas.width, maxCapturedY, 0, 0, canvas.width, maxCapturedY);
            resolve(exportCanvas(trimmed));
          } else {
            resolve(exportCanvas(canvas));
          }
        } catch (error) {
          reject(error);
        } finally {
          restoreFixedElements();
          window.scrollTo(originalScrollX, originalScrollY);
          if (stopBar) stopBar.remove();
          stopBar = null;
          if (styleTag) styleTag.remove();
        }
      })();
    } catch (e) {
      reject(e);
    }
  });
}
