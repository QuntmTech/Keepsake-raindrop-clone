from pathlib import Path

FULLPAGE = Path('lib/fullpage.ts')
BACKGROUND = Path('entrypoints/background.ts')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one {label}, found {count}')
    return source.replace(old, new, 1)

fullpage = FULLPAGE.read_text()
fullpage = replace_once(
    fullpage,
    '      const MAX_CANVAS_PIXELS = 220_000_000;',
    '      const MAX_CANVAS_PIXELS = 80_000_000; // ~320 MB RGBA ceiling before encoder overhead',
    'canvas memory ceiling',
)
old_export = '''      const exportCanvas = (canvas: HTMLCanvasElement): string => {
        const pixels = canvas.width * canvas.height;
        let dataUrl = '';
        if (pixels <= 80_000_000) {
          try {
            dataUrl = canvas.toDataURL('image/png');
          } catch {
            dataUrl = '';
          }
        }
        if (!dataUrl || dataUrl === 'data:,' || dataUrl.length < 256) dataUrl = canvas.toDataURL('image/jpeg', 0.98);
        if (!dataUrl || dataUrl === 'data:,' || dataUrl.length < 256) throw new Error('The stitched image could not be encoded');
        return dataUrl;
      };'''
new_export = '''      const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> =>
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
      };'''
fullpage = replace_once(fullpage, old_export, new_export, 'asynchronous canvas encoder')
fullpage = replace_once(fullpage, '            resolve(exportCanvas(partial));', '            resolve(await exportCanvas(partial));', 'partial async export')
fullpage = replace_once(fullpage, '            resolve(exportCanvas(canvas));', '            resolve(await exportCanvas(canvas));', 'full async export')
FULLPAGE.write_text(fullpage)

background = BACKGROUND.read_text()
start = background.index('async function startRecording(options: RecordOptions): Promise<void> {')
end = background.index('// Storage says "recording", but is the offscreen recorder actually alive?')
if start < 0 or end < 0 or end <= start:
    raise RuntimeError('Could not locate background recording start function')
new_start = r'''let recordingStartInFlight = false;
async function startRecording(options: RecordOptions): Promise<void> {
  if (recordingStartInFlight) throw new Error('A recording is already starting.');
  recordingStartInFlight = true;
  try {
    const state = await verifiedRecordingState();
    if (state.isRecording) throw new Error('A recording is already running.');
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    await ensureOffscreenDocument();
    const countdown = options.countdownSeconds ?? 0;
    // For tab capture, count down before minting the one-use stream token.
    if (options.mode === 'tab' && countdown) await runCaptureCountdown(countdown);

    let streamId: string;
    if (options.mode === 'tab') {
      streamId = await new Promise<string>((resolve, reject) => {
        browser.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id: string) => {
          if (id) resolve(id);
          else reject(new Error(browser.runtime.lastError?.message || 'Could not capture this tab'));
        });
      });
    } else {
      const sources = options.systemAudio ? ['screen', 'window', 'audio'] : ['screen', 'window'];
      streamId = await new Promise<string>((resolve, reject) => {
        browser.desktopCapture.chooseDesktopMedia(sources as any, (id: string) => {
          if (id) resolve(id);
          else reject(new Error('Capture was cancelled'));
        });
      });
      if (countdown) await runCaptureCountdown(countdown);
    }

    const startedAt = Date.now();
    const started = (await browser.runtime.sendMessage({
      target: 'ks-offscreen',
      type: 'OFFSCREEN_START',
      streamId,
      options,
    })) as { ok?: boolean; error?: string } | null;
    if (!started?.ok) {
      await browser.action.setBadgeText({ text: '' });
      throw new Error(started?.error || 'The recorder could not start');
    }
    await recordingStateStore.setValue({
      isRecording: true,
      paused: false,
      mode: options.mode,
      startedAt,
      pausedAt: null,
      pausedDurationMs: 0,
      tabId: tab.id,
      quality: options.quality,
      fps: options.fps,
    });
    await browser.action.setBadgeText({ text: 'REC' });
    await browser.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } catch (error) {
    await browser.action.setBadgeText({ text: '' }).catch(() => {});
    throw error;
  } finally {
    recordingStartInFlight = false;
  }
}

'''
background = background[:start] + new_start + background[end:]
BACKGROUND.write_text(background)

Path(__file__).unlink(missing_ok=True)
