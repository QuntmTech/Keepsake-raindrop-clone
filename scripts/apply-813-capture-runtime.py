from pathlib import Path

BACKGROUND = Path('entrypoints/background.ts')
OFFSCREEN = Path('entrypoints/offscreen/main.ts')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one {label}, found {count}')
    return source.replace(old, new, 1)


background = BACKGROUND.read_text()
background = replace_once(
    background,
    "import { captureFullPageScript } from '@/lib/fullpage';\n",
    "import { captureFullPageScript } from '@/lib/fullpage';\nimport { selectCaptureRegion } from '@/lib/captureRegion';\n",
    'capture region import',
)
background = replace_once(
    background,
    "import {\n  IDLE_RECORDING_STATE,\n  recordingStateStore,\n  screenshotFilename,\n  type RecordOptions,\n} from '@/lib/capture';",
    "import {\n  IDLE_RECORDING_STATE,\n  normalizeRecordingState,\n  recordingStateStore,\n  screenshotFilename,\n  type CaptureRect,\n  type ImageAnalysis,\n  type RecordOptions,\n} from '@/lib/capture';",
    'capture imports',
)
background = replace_once(
    background,
    "    case 'KS_CAPTURE_VISIBLE': {\n      const dataUrl = await browser.tabs.captureVisibleTab(undefined as any, { format: 'png' });\n      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });\n      await openStudio({\n        kind: 'screenshot',\n        blob: dataUrlToBlob(dataUrl),\n        pageUrl: tab?.url,\n        pageTitle: tab?.title,\n        filename: screenshotFilename('visible'),\n      });\n      return { ok: true };\n    }",
    "    case 'KS_CAPTURE_VISIBLE': {\n      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });\n      if (!tab?.id) return { ok: false, error: 'No active tab' };\n      const dataUrl = await captureValidatedPng(tab.windowId);\n      await openStudio({\n        kind: 'screenshot',\n        blob: dataUrlToBlob(dataUrl),\n        pageUrl: tab.url,\n        pageTitle: tab.title,\n        filename: screenshotFilename('visible'),\n      });\n      return { ok: true };\n    }\n\n    case 'KS_CAPTURE_REGION': {\n      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });\n      if (!tab?.id) return { ok: false, error: 'No active tab' };\n      let selection: CaptureRect | null = null;\n      try {\n        const [result] = await browser.scripting.executeScript({\n          target: { tabId: tab.id },\n          func: selectCaptureRegion,\n          args: [msg.mode],\n        });\n        selection = (result?.result as CaptureRect | null) ?? null;\n      } catch {\n        return { ok: false, error: 'This browser page does not allow area capture.' };\n      }\n      if (!selection) return { ok: false, cancelled: true };\n      const source = await captureValidatedPng(tab.windowId);\n      const cropped = await cropImage(source, selection);\n      const analysis = await analyzeImage(cropped);\n      if (analysis.blank) return { ok: false, error: 'The selected area was blank. Try selecting a slightly larger area.' };\n      await openStudio({\n        kind: 'screenshot',\n        blob: dataUrlToBlob(cropped),\n        pageUrl: tab.url,\n        pageTitle: tab.title,\n        filename: screenshotFilename(msg.mode),\n      });\n      return { ok: true };\n    }",
    'visible capture handler',
)
background = replace_once(
    background,
    "    case 'KS_CAPTURE_VIEWPORT': {\n      await tileGate();\n      const dataUrl = await browser.tabs.captureVisibleTab(undefined as any, { format: 'png' });\n      return { dataUrl };\n    }",
    "    case 'KS_CAPTURE_VIEWPORT': {\n      await tileGate();\n      try {\n        const dataUrl = await browser.tabs.captureVisibleTab(sender?.tab?.windowId, { format: 'png' });\n        return { dataUrl };\n      } catch (error) {\n        return { dataUrl: '', error: (error as Error)?.message || 'Viewport capture failed' };\n      }\n    }",
    'viewport capture handler',
)
background = replace_once(
    background,
    "    case 'KS_CAPTURE_FULL': {\n      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });\n      if (!tab?.id) return { ok: false, error: 'No active tab' };\n      // Ack immediately so the popup can close — the capture keeps running.\n      captureFullPage(tab.id).catch((e) => notify('Full-page capture failed', String((e as Error)?.message ?? e)));\n      return { ok: true };\n    }",
    "    case 'KS_CAPTURE_FULL': {\n      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });\n      if (!tab?.id) return { ok: false, error: 'No active tab' };\n      if (activeFullCaptures.has(tab.id)) return { ok: false, error: 'A full-page capture is already running in this tab.' };\n      activeFullCaptures.add(tab.id);\n      captureFullPage(tab.id)\n        .catch((error) => notify('Full-page capture failed', String((error as Error)?.message ?? error)))\n        .finally(() => activeFullCaptures.delete(tab.id!));\n      return { ok: true };\n    }",
    'full capture handler',
)
background = replace_once(
    background,
    "    case 'KS_START_RECORDING':\n      await startRecording(msg.options);\n      return { ok: true };\n\n    case 'KS_STOP_RECORDING': {",
    "    case 'KS_START_RECORDING':\n      await startRecording(msg.options);\n      return { ok: true };\n\n    case 'KS_PAUSE_RECORDING': {\n      const response = (await browser.runtime.sendMessage({ target: 'ks-offscreen', type: 'OFFSCREEN_PAUSE' }).catch(() => null)) as { ok?: boolean; error?: string } | null;\n      if (!response?.ok) return { ok: false, error: response?.error || 'The recorder could not pause.' };\n      const state = normalizeRecordingState(await recordingStateStore.getValue());\n      if (state.isRecording && !state.paused) {\n        state.paused = true;\n        state.pausedAt = Date.now();\n        await recordingStateStore.setValue(state);\n        await browser.action.setBadgeText({ text: 'II' });\n      }\n      return { ok: true };\n    }\n\n    case 'KS_RESUME_RECORDING': {\n      const response = (await browser.runtime.sendMessage({ target: 'ks-offscreen', type: 'OFFSCREEN_RESUME' }).catch(() => null)) as { ok?: boolean; error?: string } | null;\n      if (!response?.ok) return { ok: false, error: response?.error || 'The recorder could not resume.' };\n      const state = normalizeRecordingState(await recordingStateStore.getValue());\n      if (state.isRecording && state.paused) {\n        state.pausedDurationMs += state.pausedAt ? Date.now() - state.pausedAt : 0;\n        state.paused = false;\n        state.pausedAt = null;\n        await recordingStateStore.setValue(state);\n        await browser.action.setBadgeText({ text: 'REC' });\n      }\n      return { ok: true };\n    }\n\n    case 'KS_STOP_RECORDING': {",
    'recording pause handlers',
)
background = replace_once(
    background,
    "      if (!resp?.ok) {\n        // The recorder is gone (crashed / never started) — clear the stuck\n        // state instead of pretending the stop worked.\n        await recordingStateStore.setValue(IDLE_RECORDING_STATE);\n        await browser.action.setBadgeText({ text: '' });\n      }\n      return { ok: true };",
    "      if (!resp?.ok) {\n        await recordingStateStore.setValue(IDLE_RECORDING_STATE);\n        await browser.action.setBadgeText({ text: '' });\n        return { ok: false, error: 'The recorder was no longer running.' };\n      }\n      return { ok: true };",
    'recording stop response',
)
background = replace_once(
    background,
    "        const blob = await (await fetch(msg.url)).blob();\n        const tab = prior.tabId ? await browser.tabs.get(prior.tabId).catch(() => null) : null;",
    "        const blob = await (await fetch(msg.url)).blob();\n        if (blob.size < 1024) throw new Error('The recorder produced an empty video.');\n        const tab = prior.tabId ? await browser.tabs.get(prior.tabId).catch(() => null) : null;",
    'recording blob validation',
)

old_plumbing_start = background.index("// Minimum spacing between captureVisibleTab calls")
old_plumbing_end = background.index("// Offscreen creation is shared with the embedder/watcher")
if old_plumbing_start < 0 or old_plumbing_end < 0 or old_plumbing_end <= old_plumbing_start:
    raise RuntimeError('Could not locate capture plumbing section')
new_plumbing = r'''// Minimum spacing between captureVisibleTab calls (Chrome quota is roughly 2/sec).
let lastTileAt = 0;
const activeFullCaptures = new Set<number>();
async function tileGate(): Promise<void> {
  const wait = lastTileAt + 600 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastTileAt = Date.now();
}

async function analyzeImage(dataUrl: string): Promise<ImageAnalysis> {
  await ensureOffscreenDocument();
  const result = (await browser.runtime.sendMessage({
    target: 'ks-offscreen',
    type: 'OFFSCREEN_ANALYZE_IMAGE',
    dataUrl,
  })) as { ok?: boolean; analysis?: ImageAnalysis; error?: string } | null;
  if (!result?.ok || !result.analysis) throw new Error(result?.error || 'The screenshot could not be validated.');
  return result.analysis;
}

async function cropImage(dataUrl: string, rect: CaptureRect): Promise<string> {
  await ensureOffscreenDocument();
  const result = (await browser.runtime.sendMessage({
    target: 'ks-offscreen',
    type: 'OFFSCREEN_CROP_IMAGE',
    dataUrl,
    rect,
  })) as { ok?: boolean; dataUrl?: string; error?: string } | null;
  if (!result?.ok || !result.dataUrl) throw new Error(result?.error || 'The selected area could not be cropped.');
  return result.dataUrl;
}

async function captureValidatedPng(windowId?: number): Promise<string> {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    await tileGate();
    last = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
    const analysis = await analyzeImage(last);
    if (!analysis.blank) return last;
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  throw new Error('Chrome returned a blank screenshot twice. Refresh the page and try again.');
}

async function grabFullPageDataUrl(tabId: number): Promise<string | null> {
  const [result] = await browser.scripting.executeScript({
    target: { tabId },
    func: captureFullPageScript,
  });
  return (result?.result as string | null) ?? null;
}

async function captureFullPage(tabId: number): Promise<void> {
  let dataUrl = await grabFullPageDataUrl(tabId);
  if (!dataUrl) throw new Error('The full-page capture returned no image.');
  let analysis = await analyzeImage(dataUrl);
  if (analysis.blank) {
    // A transient paint failure can produce a white first pass. Retry the entire
    // capture once; never open a knowingly blank image in Capture Studio.
    await new Promise((resolve) => setTimeout(resolve, 350));
    dataUrl = await grabFullPageDataUrl(tabId);
    if (!dataUrl) throw new Error('The full-page retry returned no image.');
    analysis = await analyzeImage(dataUrl);
  }
  if (analysis.blank) throw new Error('Chrome returned a blank full-page image. Try Element capture for this app-style page.');
  const filename = screenshotFilename('full').replace(/\.png$/, dataUrl.startsWith('data:image/jpeg') ? '.jpg' : '.png');
  const tab = await browser.tabs.get(tabId).catch(() => null);
  await openStudio({
    kind: 'screenshot',
    blob: dataUrlToBlob(dataUrl),
    pageUrl: tab?.url ?? undefined,
    pageTitle: tab?.title ?? undefined,
    filename,
  });
}

// Park a fresh capture in IndexedDB (it also lands in the library right away),
// then open the Capture Studio tab on it for editing/preview.
async function openStudio(opts: {
  kind: 'screenshot' | 'recording';
  blob: Blob;
  pageUrl?: string;
  pageTitle?: string;
  filename: string;
  durationMs?: number;
}): Promise<void> {
  if (opts.blob.size < 512) throw new Error('The capture produced no usable data.');
  const result = await saveCaptureToLibrary(opts).catch(() => undefined);
  const id = await stashStudioItem({ ...opts, saveId: result?.saveId });
  await browser.tabs.create({ url: browser.runtime.getURL('/studio.html') + `#${id}` });
  if (opts.kind === 'recording' && result && !result.cloudSaved) {
    notifyUpgrade(
      'ks-upgrade-recording-',
      'Recording saved on this device',
      'Upgrade to Pro to sync recordings to your library across devices.',
    );
  }
}

'''
background = background[:old_plumbing_start] + new_plumbing + background[old_plumbing_end:]

start = background.index('async function startRecording(options: RecordOptions): Promise<void> {')
end = background.index('// Storage says "recording", but is the offscreen recorder actually alive?')
if start < 0 or end < 0 or end <= start:
    raise RuntimeError('Could not locate startRecording section')
new_recording = r'''async function runCaptureCountdown(seconds: number): Promise<void> {
  for (let remaining = seconds; remaining > 0; remaining--) {
    await browser.action.setBadgeText({ text: String(remaining) });
    await browser.action.setBadgeBackgroundColor({ color: '#4f7cff' });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function startRecording(options: RecordOptions): Promise<void> {
  const state = await verifiedRecordingState();
  if (state.isRecording) throw new Error('A recording is already running.');
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab');

  await ensureOffscreenDocument();

  let streamId: string;
  if (options.mode === 'tab') {
    streamId = await new Promise<string>((resolve, reject) => {
      browser.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id: string) => {
        if (id) resolve(id);
        else reject(new Error(browser.runtime.lastError?.message || 'Could not capture this tab'));
      });
    });
  } else {
    streamId = await new Promise<string>((resolve, reject) => {
      browser.desktopCapture.chooseDesktopMedia(['screen', 'window', 'audio'] as any, (id: string) => {
        if (id) resolve(id);
        else reject(new Error('Capture was cancelled'));
      });
    });
  }

  const countdown = options.countdownSeconds ?? 0;
  if (countdown) await runCaptureCountdown(countdown);
  const startedAt = Date.now();
  const started = (await browser.runtime.sendMessage({
    target: 'ks-offscreen',
    type: 'OFFSCREEN_START',
    streamId,
    options,
  })) as { ok?: boolean; error?: string } | null;
  if (!started?.ok) throw new Error(started?.error || 'The recorder could not start');
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
}

'''
background = background[:start] + new_recording + background[end:]

old_verified = r'''async function verifiedRecordingState() {
  const state = await recordingStateStore.getValue();
  if (!state.isRecording) return state;
  const contexts = await (browser.runtime as any).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  let live = false;
  if (contexts.length > 0) {
    const resp = (await browser.runtime
      .sendMessage({ target: 'ks-offscreen', type: 'OFFSCREEN_GET_STATE' })
      .catch(() => null)) as { ok?: boolean; recording?: boolean } | null;
    live = Boolean(resp?.recording);
  }
  if (!live) {
    await recordingStateStore.setValue(IDLE_RECORDING_STATE);
    await browser.action.setBadgeText({ text: '' });
    return IDLE_RECORDING_STATE;
  }
  return state;
}'''
new_verified = r'''async function verifiedRecordingState() {
  const state = normalizeRecordingState(await recordingStateStore.getValue());
  if (!state.isRecording) return state;
  const contexts = await (browser.runtime as any).getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  let live = false;
  let paused = state.paused;
  if (contexts.length > 0) {
    const response = (await browser.runtime
      .sendMessage({ target: 'ks-offscreen', type: 'OFFSCREEN_GET_STATE' })
      .catch(() => null)) as { ok?: boolean; recording?: boolean; paused?: boolean } | null;
    live = Boolean(response?.recording);
    paused = Boolean(response?.paused);
  }
  if (!live) {
    await recordingStateStore.setValue(IDLE_RECORDING_STATE);
    await browser.action.setBadgeText({ text: '' });
    return IDLE_RECORDING_STATE;
  }
  if (paused !== state.paused) {
    state.paused = paused;
    state.pausedAt = paused ? state.pausedAt ?? Date.now() : null;
    await recordingStateStore.setValue(state);
  }
  return state;
}'''
background = replace_once(background, old_verified, new_verified, 'verified recording state')
BACKGROUND.write_text(background)


offscreen = OFFSCREEN.read_text()
offscreen = replace_once(
    offscreen,
    "import { recordingFilename, type OffscreenCommand, type RecordOptions } from '@/lib/capture';",
    "import { recordingFilename, resolveRecordProfile, type CaptureRect, type ImageAnalysis, type OffscreenCommand, type RecordOptions } from '@/lib/capture';",
    'offscreen capture imports',
)
offscreen = replace_once(
    offscreen,
    "let recordedChunks: Blob[] = [];\nlet startTime = 0;\n\nconst QUALITY = { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 };",
    "let recordedChunks: Blob[] = [];\nlet startTime = 0;\nlet pausedAt = 0;\nlet pausedDurationMs = 0;",
    'recording globals',
)
offscreen = replace_once(
    offscreen,
    "      case 'OFFSCREEN_STOP':\n        await stopRecording();\n        return { ok: true };\n      case 'OFFSCREEN_GET_STATE' as never:\n        // The recorder's real state — the background can't infer it from the\n        // document's existence anymore (the embedder keeps this doc alive).\n        return { ok: true, recording: Boolean(mediaRecorder && mediaRecorder.state !== 'inactive') };",
    "      case 'OFFSCREEN_PAUSE':\n        pauseRecording();\n        return { ok: true };\n      case 'OFFSCREEN_RESUME':\n        resumeRecording();\n        return { ok: true };\n      case 'OFFSCREEN_STOP':\n        await stopRecording();\n        return { ok: true };\n      case 'OFFSCREEN_GET_STATE':\n        return {\n          ok: true,\n          recording: Boolean(mediaRecorder && mediaRecorder.state !== 'inactive'),\n          paused: mediaRecorder?.state === 'paused',\n        };\n      case 'OFFSCREEN_ANALYZE_IMAGE':\n        return { ok: true, analysis: await analyzeImageDataUrl(msg.dataUrl) };\n      case 'OFFSCREEN_CROP_IMAGE':\n        return { ok: true, dataUrl: await cropImageDataUrl(msg.dataUrl, msg.rect) };",
    'offscreen command handlers',
)

insert_at = offscreen.index('// System audio comes with the')
if insert_at < 0:
    raise RuntimeError('Could not locate audio section')
image_helpers = r'''async function decodeImage(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/') || blob.size < 64) throw new Error('The screenshot data is invalid.');
  return createImageBitmap(blob);
}

async function analyzeImageDataUrl(dataUrl: string): Promise<ImageAnalysis> {
  const image = await decodeImage(dataUrl);
  try {
    const sample = document.createElement('canvas');
    sample.width = 48;
    sample.height = 48;
    const context = sample.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, image.width, image.height, 0, 0, sample.width, sample.height);
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let opaque = 0;
    let min = 255;
    let max = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 8) continue;
      opaque++;
      const luminance = Math.round(pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722);
      min = Math.min(min, luminance);
      max = Math.max(max, luminance);
    }
    const total = sample.width * sample.height;
    const opaqueRatio = opaque / total;
    const luminanceRange = opaque ? max - min : 0;
    const blank = image.width < 2 || image.height < 2 || opaqueRatio < 0.02 || (luminanceRange < 2 && (max < 3 || min > 252));
    return { width: image.width, height: image.height, opaqueRatio, luminanceRange, blank };
  } finally {
    image.close();
  }
}

async function cropImageDataUrl(dataUrl: string, rect: CaptureRect): Promise<string> {
  const image = await decodeImage(dataUrl);
  try {
    const scaleX = image.width / Math.max(1, rect.viewportWidth);
    const scaleY = image.height / Math.max(1, rect.viewportHeight);
    const sourceX = Math.max(0, Math.floor(rect.x * scaleX));
    const sourceY = Math.max(0, Math.floor(rect.y * scaleY));
    const sourceWidth = Math.min(image.width - sourceX, Math.max(1, Math.ceil(rect.width * scaleX)));
    const sourceHeight = Math.min(image.height - sourceY, Math.max(1, Math.ceil(rect.height * scaleY)));
    if (sourceWidth < 2 || sourceHeight < 2) throw new Error('The selected area is too small.');
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
    const output = canvas.toDataURL('image/png');
    if (!output || output === 'data:,' || output.length < 128) throw new Error('The selected area could not be encoded.');
    return output;
  } finally {
    image.close();
  }
}

'''
offscreen = offscreen[:insert_at] + image_helpers + offscreen[insert_at:]

start = offscreen.index('async function buildAudioTracks(options: RecordOptions): Promise<MediaStreamTrack[]> {')
end = offscreen.index('async function startRecording(streamId: string, options: RecordOptions): Promise<void> {')
if start < 0 or end < 0 or end <= start:
    raise RuntimeError('Could not locate audio builder')
new_audio = r'''async function buildAudioTracks(options: RecordOptions): Promise<MediaStreamTrack[]> {
  const systemTracks = options.systemAudio ? mediaStream?.getAudioTracks() ?? [] : [];
  microphoneStream = options.microphone
    ? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
    : null;
  const micTracks = microphoneStream?.getAudioTracks() ?? [];
  if (!systemTracks.length) return micTracks;

  // Mix tab/system audio and microphone into one recorder track. For tab capture,
  // route the captured audio back to speakers too; Chrome otherwise silences the
  // tab while tabCapture is active. Desktop capture is not played back to avoid
  // feedback loops.
  audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();
  const systemSource = audioContext.createMediaStreamSource(new MediaStream(systemTracks));
  systemSource.connect(destination);
  if (options.mode === 'tab') systemSource.connect(audioContext.destination);
  if (micTracks.length) audioContext.createMediaStreamSource(new MediaStream(micTracks)).connect(destination);
  return destination.stream.getAudioTracks();
}

'''
offscreen = offscreen[:start] + new_audio + offscreen[end:]

start = offscreen.index('async function startRecording(streamId: string, options: RecordOptions): Promise<void> {')
end = offscreen.index('async function stopRecording(): Promise<void> {')
if start < 0 or end < 0 or end <= start:
    raise RuntimeError('Could not locate offscreen startRecording')
new_start = r'''async function startRecording(streamId: string, options: RecordOptions): Promise<void> {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') throw new Error('Already recording');
  await cleanup();

  const profile = resolveRecordProfile(options.quality, options.fps);
  const source = options.mode === 'desktop' ? 'desktop' : 'tab';
  const constraints: any = {
    audio: options.systemAudio
      ? { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId } }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: source,
        chromeMediaSourceId: streamId,
        maxWidth: profile.width,
        maxHeight: profile.height,
        maxFrameRate: profile.fps,
      },
    },
  };
  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

  recorderStream = new MediaStream();
  const videoTrack = mediaStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('No video track available for recording');
  recorderStream.addTrack(videoTrack);
  for (const track of await buildAudioTracks(options)) {
    if (!recorderStream.getAudioTracks().some((current) => current.id === track.id)) recorderStream.addTrack(track);
  }

  const codecs = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = codecs.find((value) => MediaRecorder.isTypeSupported(value)) ?? 'video/webm';
  recordedChunks = [];
  startTime = Date.now();
  pausedAt = 0;
  pausedDurationMs = 0;
  mediaRecorder = new MediaRecorder(recorderStream, { mimeType, videoBitsPerSecond: profile.bitrate });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) recordedChunks.push(event.data);
  };
  mediaRecorder.onerror = (event) => {
    const message = (event as Event & { error?: DOMException }).error?.message || 'Recorder failed';
    chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: message }).catch(() => {});
  };

  const onTrackEnd = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      stopRecording().catch((error) =>
        chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: (error as Error)?.message || 'Stop failed' }).catch(() => {}),
      );
    }
  };
  mediaStream.getTracks().forEach((track) => track.addEventListener('ended', onTrackEnd, { once: true }));
  mediaRecorder.start(1000);
}

function pauseRecording(): void {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') throw new Error('No active recording to pause');
  mediaRecorder.requestData();
  mediaRecorder.pause();
  pausedAt = Date.now();
}

function resumeRecording(): void {
  if (!mediaRecorder || mediaRecorder.state !== 'paused') throw new Error('The recording is not paused');
  pausedDurationMs += pausedAt ? Date.now() - pausedAt : 0;
  pausedAt = 0;
  mediaRecorder.resume();
}

'''
offscreen = offscreen[:start] + new_start + offscreen[end:]

start = offscreen.index('async function stopRecording(): Promise<void> {')
end = offscreen.index('async function cleanup(): Promise<void> {')
if start < 0 or end < 0 or end <= start:
    raise RuntimeError('Could not locate offscreen stopRecording')
new_stop = r'''async function stopRecording(): Promise<void> {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') throw new Error('No active recording');
  const recorder = mediaRecorder;
  if (recorder.state === 'paused') {
    pausedDurationMs += pausedAt ? Date.now() - pausedAt : 0;
    pausedAt = 0;
    recorder.resume();
  }
  try {
    recorder.requestData();
  } catch {
    /* some encoders flush automatically on stop */
  }
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.stop();
  await stopped;

  const mimeType = recorder.mimeType || 'video/webm';
  const blob = new Blob(recordedChunks, { type: mimeType });
  const effectiveDurationMs = Math.max(0, Date.now() - startTime - pausedDurationMs);
  if (blob.size < 1024 || effectiveDurationMs < 100) {
    await cleanup();
    throw new Error('The recording ended before usable video was produced.');
  }
  const url = URL.createObjectURL(blob);
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const filename = recordingFilename(startTime, ext);
  await cleanup();

  const response = await chrome.runtime
    .sendMessage({ type: 'KS_RECORDING_READY', url, filename, size: blob.size, durationMs: effectiveDurationMs })
    .catch(() => null);
  if (!(response as { ok?: boolean } | null)?.ok) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename.split('/').pop() ?? 'keepsake-recording.webm';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
}

'''
offscreen = offscreen[:start] + new_stop + offscreen[end:]
offscreen = replace_once(
    offscreen,
    "  mediaRecorder = null;\n  recordedChunks = [];\n  if (audioContext) {",
    "  mediaRecorder = null;\n  recordedChunks = [];\n  pausedAt = 0;\n  pausedDurationMs = 0;\n  if (audioContext) {",
    'cleanup pause reset',
)
OFFSCREEN.write_text(offscreen)

Path(__file__).unlink(missing_ok=True)
