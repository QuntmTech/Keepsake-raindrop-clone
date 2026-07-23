// Robust full-page screenshot script. Injected through chrome.scripting, so the
// function must remain self-contained. It supports normal documents and large
// app-style inner scrollers, preserves native device-pixel sharpness, retries
// failed viewport grabs, and never hides a full-screen iframe/app shell merely
// because it uses position:fixed.

export function captureFullPageScript(): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const html = document.documentElement;
      const body = document.body;
      const windowWidth = html.clientWidth || window.innerWidth;
      const windowHeight = html.clientHeight || window.innerHeight;
      const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
      const nextPaint = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));

      type Target = {
        kind: 'window' | 'element';
        element?: HTMLElement;
        fullWidth: number;
        fullHeight: number;
        viewportWidth: number;
        viewportHeight: number;
        rect: { left: number; top: number; width: number; height: number };
        startX: number;
        startY: number;
      };

      const windowTarget = (): Target => ({
        kind: 'window',
        fullWidth: Math.max(html.scrollWidth, body?.scrollWidth ?? 0, windowWidth),
        fullHeight: Math.max(html.scrollHeight, body?.scrollHeight ?? 0, windowHeight),
        viewportWidth: windowWidth,
        viewportHeight: windowHeight,
        rect: { left: 0, top: 0, width: windowWidth, height: windowHeight },
        startX: window.scrollX,
        startY: window.scrollY,
      });

      // App pages often lock body scrolling and put the real document inside a
      // large overflow:auto pane. Pick that pane only when it covers a meaningful
      // part of the viewport and contains substantially more content than it shows.
      const findTarget = (): Target => {
        let best: { element: HTMLElement; score: number } | null = null;
        const viewportArea = Math.max(1, windowWidth * windowHeight);
        for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          if (element.id.startsWith('__keepsake_') || element.id === 'keepsake-quickbar') continue;
          const style = getComputedStyle(element);
          if (!/(auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) continue;
          const extraX = Math.max(0, element.scrollWidth - element.clientWidth);
          const extraY = Math.max(0, element.scrollHeight - element.clientHeight);
          if (extraX < 80 && extraY < 160) continue;
          const rect = element.getBoundingClientRect();
          const visibleWidth = Math.max(0, Math.min(windowWidth, rect.right) - Math.max(0, rect.left));
          const visibleHeight = Math.max(0, Math.min(windowHeight, rect.bottom) - Math.max(0, rect.top));
          const visibleArea = visibleWidth * visibleHeight;
          if (visibleArea / viewportArea < 0.28 || visibleWidth < 240 || visibleHeight < 180) continue;
          const score = visibleArea / viewportArea * (extraY + extraX * 0.35);
          if (!best || score > best.score) best = { element, score };
        }
        if (!best) return windowTarget();
        const element = best.element;
        const rect = element.getBoundingClientRect();
        return {
          kind: 'element',
          element,
          fullWidth: Math.max(element.scrollWidth, element.clientWidth),
          fullHeight: Math.max(element.scrollHeight, element.clientHeight),
          viewportWidth: element.clientWidth,
          viewportHeight: element.clientHeight,
          rect: { left: rect.left, top: rect.top, width: element.clientWidth, height: element.clientHeight },
          startX: element.scrollLeft,
          startY: element.scrollTop,
        };
      };

      const target = findTarget();
      const MAX_CANVAS_DIMENSION = 16384;
      const MAX_CANVAS_PIXELS = 80_000_000; // ~320 MB RGBA ceiling before encoder overhead
      const positions = (full: number, viewport: number): number[] => {
        const max = Math.max(0, full - viewport);
        if (!max) return [0];
        const out: number[] = [];
        for (let value = 0; value < max; value += viewport) out.push(value);
        if (out[out.length - 1] !== max) out.push(max);
        return out;
      };
      const xs = positions(target.fullWidth, target.viewportWidth);
      const ys = positions(target.fullHeight, target.viewportHeight);

      const getScroll = () =>
        target.kind === 'window'
          ? { x: window.scrollX, y: window.scrollY }
          : { x: target.element!.scrollLeft, y: target.element!.scrollTop };
      const setScroll = (x: number, y: number) => {
        if (target.kind === 'window') window.scrollTo(x, y);
        else {
          target.element!.scrollLeft = x;
          target.element!.scrollTop = y;
        }
      };
      const settle = async (x: number, y: number) => {
        for (const pause of [90, 170, 300]) {
          setScroll(x, y);
          await delay(pause);
          await nextPaint();
          const actual = getScroll();
          if (Math.abs(actual.x - x) <= 1 && Math.abs(actual.y - y) <= 1) return;
        }
      };

      const visibleRect = () => ({
        left: target.rect.left,
        top: target.rect.top,
        right: target.rect.left + target.viewportWidth,
        bottom: target.rect.top + target.viewportHeight,
      });
      const waitForVisibleImages = async () => {
        const bounds = visibleRect();
        const pending = Array.from(document.images).filter((image) => {
          if (image.complete) return false;
          const rect = image.getBoundingClientRect();
          return rect.right >= bounds.left && rect.left <= bounds.right && rect.bottom >= bounds.top && rect.top <= bounds.bottom;
        });
        if (!pending.length) return;
        await Promise.race([
          Promise.all(
            pending.map(
              (image) =>
                new Promise<void>((done) => {
                  if (image.complete) return done();
                  image.addEventListener('load', () => done(), { once: true });
                  image.addEventListener('error', () => done(), { once: true });
                }),
            ),
          ),
          delay(1600),
        ]);
      };

      let progressBar: HTMLElement | null = null;
      const hidden: Array<{ element: HTMLElement; css: string }> = [];
      const shouldHideOverlay = (element: HTMLElement): boolean => {
        if (element === progressBar || progressBar?.contains(element)) return false;
        if (element.id === 'keepsake-quickbar' || element.closest('#keepsake-quickbar')) return true;
        const style = getComputedStyle(element);
        if (style.position !== 'fixed' && style.position !== 'sticky') return false;
        if (element === target.element || element.contains(target.element ?? null)) return false;
        if (element.matches('iframe,video,canvas') || element.querySelector('iframe,video,canvas')) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const areaRatio = (rect.width * rect.height) / Math.max(1, windowWidth * windowHeight);
        // Preserve app shells, preview panes, modal workspaces, and large fixed
        // layouts. Hide only compact toolbars/badges/chat bubbles that would repeat.
        if (areaRatio > 0.28 || (rect.width > windowWidth * 0.72 && rect.height > windowHeight * 0.32)) return false;
        return true;
      };
      const walkAndHide = (root: Node) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode() as HTMLElement | null;
        while (node) {
          if (shouldHideOverlay(node)) {
            hidden.push({ element: node, css: node.style.cssText });
            node.style.setProperty('visibility', 'hidden', 'important');
          }
          if (node.shadowRoot) walkAndHide(node.shadowRoot);
          node = walker.nextNode() as HTMLElement | null;
        }
      };
      const restoreHidden = () => {
        for (const item of hidden) item.element.style.cssText = item.css;
        hidden.length = 0;
      };

      const requestViewport = async (): Promise<string> => {
        if (progressBar) progressBar.style.visibility = 'hidden';
        await nextPaint();
        try {
          let lastError = '';
          for (let attempt = 0; attempt < 3; attempt++) {
            const dataUrl = await new Promise<string>((done) => {
              chrome.runtime.sendMessage({ type: 'KS_CAPTURE_VIEWPORT' }, (response) => {
                lastError = chrome.runtime.lastError?.message || response?.error || '';
                done(response?.dataUrl || '');
              });
            });
            if (dataUrl.startsWith('data:image/') && dataUrl.length > 256) return dataUrl;
            await delay(250 + attempt * 250);
          }
          throw new Error(lastError || 'Chrome returned an empty viewport image');
        } finally {
          if (progressBar) progressBar.style.visibility = '';
        }
      };
      const decode = (dataUrl: string): Promise<HTMLImageElement> =>
        new Promise((done, fail) => {
          const image = new Image();
          const timer = setTimeout(() => fail(new Error('Screenshot tile decode timed out')), 8000);
          image.onload = () => {
            clearTimeout(timer);
            done(image);
          };
          image.onerror = () => {
            clearTimeout(timer);
            fail(new Error('Chrome returned an unreadable screenshot tile'));
          };
          image.src = dataUrl;
        });
      const looksEmpty = (image: CanvasImageSource, width: number, height: number): boolean => {
        const sample = document.createElement('canvas');
        sample.width = 40;
        sample.height = 40;
        const context = sample.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, 0, width, height, 0, 0, 40, 40);
        const pixels = context.getImageData(0, 0, 40, 40).data;
        let opaque = 0;
        let min = 255;
        let max = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3];
          if (alpha < 8) continue;
          opaque++;
          const luminance = Math.round(pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722);
          min = Math.min(min, luminance);
          max = Math.max(max, luminance);
        }
        if (opaque < 20) return true;
        return max - min < 2 && (max < 3 || min > 252);
      };
      const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
        new Promise((done) => canvas.toBlob(done, type, quality));
      const blobDataUrl = (blob: Blob): Promise<string> =>
        new Promise((done, fail) => {
          const reader = new FileReader();
          reader.onload = () => done(String(reader.result || ''));
          reader.onerror = () => fail(new Error('The stitched image could not be read'));
          reader.readAsDataURL(blob);
        });
      const exportCanvas = async (canvas: HTMLCanvasElement): Promise<string> => {
        const pixels = canvas.width * canvas.height;
        let blob: Blob | null = null;
        if (pixels <= 80_000_000) blob = await canvasBlob(canvas, 'image/png');
        if (!blob || blob.size < 128) blob = await canvasBlob(canvas, 'image/jpeg', 0.98);
        if (!blob || blob.size < 128) throw new Error('The stitched image could not be encoded');
        const dataUrl = await blobDataUrl(blob);
        if (!dataUrl.startsWith('data:image/') || dataUrl.length < 256) throw new Error('The stitched image is invalid');
        return dataUrl;
      };

      (async () => {
        let freeze: HTMLStyleElement | null = null;
        let toolbarStyles: HTMLStyleElement | null = null;
        try {
          let stopped = false;
          freeze = document.createElement('style');
          freeze.textContent = `
            html, body { scroll-behavior: auto !important; }
            *, *::before, *::after { animation-play-state: paused !important; transition: none !important; }
          `;
          document.head.appendChild(freeze);

          progressBar = document.createElement('div');
          progressBar.id = '__keepsake_capture_bar__';
          progressBar.innerHTML = '<span id="__ks_capture_progress__">Preparing Ultra HD capture…</span><button id="__ks_capture_stop__">Stop</button>';
          progressBar.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:12px;padding:10px 16px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:rgba(16,18,28,.92);box-shadow:0 10px 36px rgba(0,0,0,.4);font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:white;';
          toolbarStyles = document.createElement('style');
          toolbarStyles.textContent = '#__ks_capture_stop__{border:1px solid rgba(248,113,113,.45);border-radius:8px;background:rgba(248,113,113,.15);padding:5px 11px;color:#fda4af;font:600 12px inherit;cursor:pointer}';
          document.head.appendChild(toolbarStyles);
          document.body.appendChild(progressBar);
          document.getElementById('__ks_capture_stop__')?.addEventListener('click', () => {
            stopped = true;
          });
          const progress = document.getElementById('__ks_capture_progress__');

          walkAndHide(document.documentElement);
          const totalTiles = xs.length * ys.length;
          let completed = 0;
          let firstImage: HTMLImageElement | null = null;
          let rawScale = 1;
          let sourceX = 0;
          let sourceY = 0;
          let sourceWidth = 0;
          let sourceHeight = 0;
          let exportScale = 1;
          let canvas: HTMLCanvasElement | null = null;
          let context: CanvasRenderingContext2D | null = null;
          let maxDrawY = 0;

          for (const y of ys) {
            for (const x of xs) {
              if (stopped) break;
              await settle(x, y);
              await waitForVisibleImages();
              await nextPaint();
              const tileData = await requestViewport();
              const image = await decode(tileData);
              if (!firstImage) {
                firstImage = image;
                rawScale = image.width / Math.max(1, window.innerWidth);
                sourceX = Math.max(0, Math.round(target.rect.left * rawScale));
                sourceY = Math.max(0, Math.round(target.rect.top * rawScale));
                sourceWidth = Math.min(image.width - sourceX, Math.round(target.viewportWidth * rawScale));
                sourceHeight = Math.min(image.height - sourceY, Math.round(target.viewportHeight * rawScale));
                if (sourceWidth <= 0 || sourceHeight <= 0 || looksEmpty(image, image.width, image.height)) {
                  throw new Error('Chrome captured an empty first frame. Try Visible area or Element capture.');
                }
                const dimensionScale = Math.min(
                  1,
                  MAX_CANVAS_DIMENSION / Math.max(1, target.fullWidth * rawScale),
                  MAX_CANVAS_DIMENSION / Math.max(1, target.fullHeight * rawScale),
                );
                const pixelScale = Math.min(
                  1,
                  Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, target.fullWidth * rawScale * target.fullHeight * rawScale)),
                );
                exportScale = rawScale * Math.min(dimensionScale, pixelScale);
                canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.floor(target.fullWidth * exportScale));
                canvas.height = Math.max(1, Math.floor(target.fullHeight * exportScale));
                context = canvas.getContext('2d')!;
                const resampling = Math.abs(exportScale - rawScale) > 0.001;
                context.imageSmoothingEnabled = resampling;
                if (resampling) context.imageSmoothingQuality = 'high';
              }

              const actual = getScroll();
              const drawX = Math.max(0, Math.round(actual.x * exportScale));
              const drawY = Math.max(0, Math.round(actual.y * exportScale));
              const drawWidth = Math.max(1, Math.round(sourceWidth * (exportScale / rawScale)));
              const drawHeight = Math.max(1, Math.round(sourceHeight * (exportScale / rawScale)));
              context!.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
              maxDrawY = Math.max(maxDrawY, drawY + drawHeight);
              completed++;
              if (progress) progress.textContent = `Capturing ${completed} of ${totalTiles} · ${canvas!.width.toLocaleString()} × ${canvas!.height.toLocaleString()}`;
            }
            if (stopped) break;
          }

          if (!canvas || completed === 0) throw new Error('No screenshot tiles were captured');
          if (stopped && maxDrawY < canvas.height) {
            const partial = document.createElement('canvas');
            partial.width = canvas.width;
            partial.height = Math.max(1, maxDrawY);
            partial.getContext('2d')!.drawImage(canvas, 0, 0);
            resolve(await exportCanvas(partial));
          } else {
            resolve(await exportCanvas(canvas));
          }
        } catch (error) {
          reject(error);
        } finally {
          restoreHidden();
          freeze?.remove();
          toolbarStyles?.remove();
          progressBar?.remove();
          progressBar = null;
          setScroll(target.startX, target.startY);
        }
      })();
    } catch (error) {
      reject(error);
    }
  });
}
