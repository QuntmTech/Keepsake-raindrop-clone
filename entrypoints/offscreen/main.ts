// Offscreen recorder (ported from CaptureCraft's offscreen.js). The background
// worker acquires a stream id (tabCapture / desktopCapture) and sends it here;
// this document turns it into a MediaStream, mixes in the microphone if asked,
// runs MediaRecorder, and on stop mints a blob: URL for the background to
// download. Blobs can't cross the message boundary (JSON serialization), but a
// blob: URL string can — and it stays valid while this document lives.

import { recordingFilename, resolveRecordProfile, type CaptureRect, type ImageAnalysis, type OffscreenCommand, type RecordOptions } from '@/lib/capture';
import { db } from '@/lib/save';

// ── Local embedding engine (Phase 1) ────────────────────────────────────────
// all-MiniLM-L6-v2 via transformers.js: 384-dim sentence vectors, fully local.
// The model stays loaded in this document's memory; weights are cached by the
// Cache API after the first download so it fetches once. Lazy: nothing loads
// until the first embed job arrives.

type FeaturePipeline = (texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{
  tolist(): number[][];
}>;

let embedderPromise: Promise<FeaturePipeline> | null = null;

function getEmbedder(): Promise<FeaturePipeline> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false; // fetch from the HF hub (cached after first run)
      env.useBrowserCache = true;
      const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      return ((texts, opts) => pipe(texts, opts)) as FeaturePipeline;
    })();
    embedderPromise.catch(() => {
      embedderPromise = null; // allow a retry after a failed model download
    });
  }
  return embedderPromise;
}

async function embed(texts: string[]): Promise<number[][]> {
  const pipe = await getEmbedder();
  const out = await pipe(
    texts.map((t) => t.slice(0, 2000)),
    { pooling: 'mean', normalize: true },
  );
  return out.tolist();
}

// Cosine over unit vectors = dot product.
function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// Semantic match: embed the query, scan the library's vectors. Vectors are
// held in a compact in-memory cache (id + canonical + Float32Array) so a
// navigation never deserializes full Save rows (fullText etc.) — refreshed
// on a short TTL since this document is long-lived. Local-only.
interface VecEntry {
  id: string;
  canonicalUrl: string;
  vec: Float32Array;
}
let vecCache: { ts: number; entries: VecEntry[] } | null = null;
const VEC_TTL = 30_000;

async function libraryVectors(): Promise<VecEntry[]> {
  if (vecCache && Date.now() - vecCache.ts < VEC_TTL) return vecCache.entries;
  const entries: VecEntry[] = [];
  await db.saves.each((s) => {
    // Launcher tiles are not library content — never surface them as recall.
    if (s.organization.homeOnly) return;
    if (!s.ai.embedding || s.ai.embedding.length === 0) return;
    entries.push({ id: s.id, canonicalUrl: s.canonicalUrl, vec: Float32Array.from(s.ai.embedding) });
  });
  vecCache = { ts: Date.now(), entries };
  return entries;
}

async function matchLibrary(
  text: string,
  threshold: number,
  limit: number,
  excludeCanonical?: string,
): Promise<Array<{ id: string; score: number }>> {
  const [q] = await embed([text]);
  const scored: Array<{ id: string; score: number }> = [];
  for (const e of await libraryVectors()) {
    if (excludeCanonical && e.canonicalUrl === excludeCanonical) continue;
    const score = dot(q, e.vec as unknown as number[]);
    if (score >= threshold) scored.push({ id: e.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

let mediaStream: MediaStream | null = null; // raw capture stream
let microphoneStream: MediaStream | null = null;
let recorderStream: MediaStream | null = null; // what MediaRecorder consumes
let audioContext: AudioContext | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let startTime = 0;
let pausedAt = 0;
let pausedDurationMs = 0;

chrome.runtime.onMessage.addListener((msg: OffscreenCommand, _sender, sendResponse) => {
  if (msg?.target !== 'ks-offscreen') return;
  (async () => {
    switch (msg.type) {
      case 'OFFSCREEN_START':
        await startRecording(msg.streamId, msg.options);
        return { ok: true };
      case 'OFFSCREEN_PAUSE':
        pauseRecording();
        return { ok: true };
      case 'OFFSCREEN_RESUME':
        resumeRecording();
        return { ok: true };
      case 'OFFSCREEN_STOP':
        await stopRecording();
        return { ok: true };
      case 'OFFSCREEN_GET_STATE':
        return {
          ok: true,
          recording: Boolean(mediaRecorder && mediaRecorder.state !== 'inactive'),
          paused: mediaRecorder?.state === 'paused',
        };
      case 'OFFSCREEN_ANALYZE_IMAGE':
        return { ok: true, analysis: await analyzeImageDataUrl(msg.dataUrl) };
      case 'OFFSCREEN_CROP_IMAGE':
        return { ok: true, dataUrl: await cropImageDataUrl(msg.dataUrl, msg.rect) };
      case 'OFFSCREEN_EMBED' as never: {
        const m = msg as unknown as { texts: string[] };
        return { ok: true, vectors: await embed(m.texts) };
      }
      case 'OFFSCREEN_MATCH' as never: {
        const m = msg as unknown as { text: string; threshold: number; limit: number; excludeCanonical?: string };
        return { ok: true, matches: await matchLibrary(m.text, m.threshold, m.limit, m.excludeCanonical) };
      }
      case 'OFFSCREEN_WATCH_FETCH' as never: {
        const m = msg as unknown as { url: string; mode: string | null; selector?: string; prevText?: string };
        return await watchFetch(m.url, m.mode, m.selector, m.prevText);
      }
      default:
        return { ok: false };
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: (e as Error)?.message || String(e) }));
  return true; // async response
});

// ── Living Bookmarks: fetch + parse (Phase 3) ───────────────────────────────
// The service worker has no DOMParser — pages are fetched and parsed here.
// Tier 1: plain fetch. JS-rendered pages that yield nothing get flagged so the
// background switches them to "checks on visit".

function normalizeForDiff(text: string): string {
  return text
    .replace(/\d[\d.,:/-]*/g, '#') // dates, counters, prices — trivial churn
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Jaccard over 3-word shingles — cheap, order-tolerant similarity.
function shingleSimilarity(a: string, b: string): number {
  const shingles = (t: string) => {
    const words = t.split(' ');
    const set = new Set<string>();
    for (let i = 0; i < words.length - 2; i++) set.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    return set;
  };
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size && !sb.size) return 1;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / (sa.size + sb.size - inter || 1);
}

// Compact human diff: the first few lines that appear/disappear.
function compactDiff(prev: string, next: string): string {
  const pl = new Set(prev.split(/(?<=[.!?])\s+/).map((s) => s.trim()));
  const added = next
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && !pl.has(s))
    .slice(0, 3);
  return added.length ? `New: ${added.join(' · ')}` : 'Content changed';
}

// Readability-lite: main/article text without nav/script noise.
function extractMainText(doc: Document): string {
  doc.querySelectorAll('script,style,nav,header,footer,aside,noscript,svg').forEach((el) => el.remove());
  const root =
    doc.querySelector('article, main, [role="main"], #content, .content, .post, .article') ?? doc.body;
  return (root?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60_000);
}

// Price extraction order (brief 3.2): JSON-LD schema.org Product → og/meta
// price tags → user-taught CSS selector.
function extractPrice(doc: Document, selector?: string): { price?: number; raw?: string } {
  const parseNum = (v: unknown): number | undefined => {
    if (v == null) return undefined;
    const n = Number(String(v).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  // 1. JSON-LD
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const nodes = Array.isArray(data) ? data : data['@graph'] ?? [data];
      for (const node of nodes) {
        const type = String(node?.['@type'] ?? '');
        if (!/Product|Offer/i.test(type)) continue;
        const offers = node.offers ?? node;
        const list = Array.isArray(offers) ? offers : [offers];
        for (const o of list) {
          const price = parseNum(o?.price ?? o?.lowPrice ?? o?.highPrice ?? o?.priceSpecification?.price);
          if (price != null) return { price, raw: `${o?.priceCurrency ?? ''} ${price}`.trim() };
        }
      }
    } catch {
      /* malformed JSON-LD is everywhere */
    }
  }
  // 2. Meta tags
  const meta =
    doc.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"], meta[itemprop="price"]')?.getAttribute('content') ??
    doc.querySelector('[itemprop="price"]')?.getAttribute('content');
  const metaPrice = parseNum(meta);
  if (metaPrice != null) return { price: metaPrice, raw: String(meta) };
  // 3. User-taught selector
  if (selector) {
    const el = doc.querySelector(selector);
    const raw = el?.textContent?.trim();
    const price = parseNum(raw?.match(/[\d.,]+/)?.[0]);
    if (price != null) return { price, raw };
  }
  return {};
}

function extractAvailability(doc: Document, selector?: string): boolean | undefined {
  if (selector) {
    const el = doc.querySelector(selector);
    if (el) return !/out of stock|sold out|unavailable/i.test(el.textContent ?? '');
  }
  // JSON-LD availability first, then common text patterns.
  const html = doc.documentElement.outerHTML;
  if (/schema\.org\/(InStock|InStoreOnly|OnlineOnly)/i.test(html)) return true;
  if (/schema\.org\/(OutOfStock|SoldOut|Discontinued)/i.test(html)) return false;
  const body = doc.body?.textContent ?? '';
  if (/out of stock|sold out|currently unavailable|niet op voorraad/i.test(body)) return false;
  if (/add to cart|buy now|in stock|add to bag/i.test(body)) return true;
  return undefined;
}

async function watchFetch(url: string, mode: string | null, selector?: string, prevText?: string) {
  let res: Response;
  try {
    // Hard timeout: a tarpit host must never stall the watch scheduler.
    res = await fetch(url, { redirect: 'follow', credentials: 'omit', signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
  if (!res.ok) return { ok: false, httpStatus: res.status };
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const mainText = extractMainText(doc);
  const looksJsRendered = mainText.length < 200; // empty shell → needs a real DOM

  const out: Record<string, unknown> = { ok: true, httpStatus: res.status, looksJsRendered };

  if (mode === 'price') {
    const { price, raw } = extractPrice(doc, selector);
    out.price = price;
    out.priceRaw = raw;
  } else if (mode === 'content') {
    if (selector) {
      const el = doc.querySelector(selector);
      out.selectorFound = Boolean(el);
      out.selectorValue = el?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 500);
    } else {
      const normalized = normalizeForDiff(mainText);
      out.text = normalized;
      if (prevText) {
        out.similarity = shingleSimilarity(prevText, normalized);
        out.diff = compactDiff(prevText, normalized);
      }
    }
  } else if (mode === 'availability') {
    out.inStock = extractAvailability(doc, selector);
  }
  return out;
}

async function decodeImage(dataUrl: string): Promise<ImageBitmap> {
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

// System audio comes with the capture stream; the microphone is a separate
// getUserMedia stream. When both are on, mix them through WebAudio into one
// track (a MediaRecorder can only record a single audio track).
async function buildAudioTracks(options: RecordOptions): Promise<MediaStreamTrack[]> {
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

async function startRecording(streamId: string, options: RecordOptions): Promise<void> {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') throw new Error('Already recording');
  await cleanup();
  try {
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
      cleanup()
        .catch(() => {})
        .finally(() => chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: message }).catch(() => {}));
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
  } catch (error) {
    await cleanup();
    throw error;
  }
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

async function stopRecording(): Promise<void> {
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
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function cleanup(): Promise<void> {
  for (const stream of [recorderStream, mediaStream, microphoneStream]) {
    stream?.getTracks().forEach((t) => t.stop());
  }
  recorderStream = mediaStream = microphoneStream = null;
  mediaRecorder = null;
  recordedChunks = [];
  pausedAt = 0;
  pausedDurationMs = 0;
  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }
}
