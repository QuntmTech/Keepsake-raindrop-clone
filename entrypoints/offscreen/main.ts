// Offscreen recorder (ported from CaptureCraft's offscreen.js). The background
// worker acquires a stream id (tabCapture / desktopCapture) and sends it here;
// this document turns it into a MediaStream, mixes in the microphone if asked,
// runs MediaRecorder, and on stop mints a blob: URL for the background to
// download. Blobs can't cross the message boundary (JSON serialization), but a
// blob: URL string can — and it stays valid while this document lives.

import { recordingFilename, type OffscreenCommand, type RecordOptions } from '@/lib/capture';
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

const QUALITY = { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 };

chrome.runtime.onMessage.addListener((msg: OffscreenCommand, _sender, sendResponse) => {
  if (msg?.target !== 'ks-offscreen') return;
  (async () => {
    switch (msg.type) {
      case 'OFFSCREEN_START':
        await startRecording(msg.streamId, msg.options);
        return { ok: true };
      case 'OFFSCREEN_STOP':
        await stopRecording();
        return { ok: true };
      case 'OFFSCREEN_GET_STATE' as never:
        // The recorder's real state — the background can't infer it from the
        // document's existence anymore (the embedder keeps this doc alive).
        return { ok: true, recording: Boolean(mediaRecorder && mediaRecorder.state !== 'inactive') };
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

// System audio comes with the capture stream; the microphone is a separate
// getUserMedia stream. When both are on, mix them through WebAudio into one
// track (a MediaRecorder can only record a single audio track).
async function buildAudioTracks(options: RecordOptions): Promise<MediaStreamTrack[]> {
  const systemTracks = options.systemAudio ? mediaStream?.getAudioTracks() ?? [] : [];
  if (!options.microphone) return systemTracks;
  microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const micTracks = microphoneStream.getAudioTracks();
  if (!systemTracks.length) return micTracks;
  audioContext = new AudioContext();
  const dest = audioContext.createMediaStreamDestination();
  audioContext.createMediaStreamSource(new MediaStream(systemTracks)).connect(dest);
  if (micTracks.length) audioContext.createMediaStreamSource(new MediaStream(micTracks)).connect(dest);
  return dest.stream.getAudioTracks();
}

async function startRecording(streamId: string, options: RecordOptions): Promise<void> {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') throw new Error('Already recording');
  await cleanup();

  const source = options.mode === 'desktop' ? 'desktop' : 'tab';
  // chromeMediaSource constraints are Chrome-only and untyped.
  const constraints: any = {
    audio: options.systemAudio
      ? { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId } }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: source,
        chromeMediaSourceId: streamId,
        maxWidth: QUALITY.width,
        maxHeight: QUALITY.height,
        maxFrameRate: QUALITY.fps,
      },
    },
  };
  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

  recorderStream = new MediaStream();
  const videoTrack = mediaStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('No video track available for recording');
  recorderStream.addTrack(videoTrack);
  for (const track of await buildAudioTracks(options)) {
    try {
      recorderStream.addTrack(track);
    } catch {
      /* duplicate track */
    }
  }

  // Negotiate the best supported codec, newest first.
  const codecs = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = codecs.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

  recordedChunks = [];
  startTime = Date.now();
  mediaRecorder = new MediaRecorder(recorderStream, { mimeType, videoBitsPerSecond: QUALITY.bitrate });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onerror = () => {
    chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: 'Recorder failed' }).catch(() => {});
  };

  // The user can end the capture from Chrome's own "stop sharing" UI — treat
  // that exactly like pressing Stop, or the extension stays stuck recording.
  const onTrackEnd = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      stopRecording().catch((e) =>
        chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: (e as Error)?.message || 'Stop failed' }).catch(() => {}),
      );
    }
  };
  mediaStream.getTracks().forEach((t) => t.addEventListener('ended', onTrackEnd, { once: true }));

  // 1s timeslice keeps memory bounded on long recordings.
  mediaRecorder.start(1000);
}

async function stopRecording(): Promise<void> {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') throw new Error('No active recording');
  const recorder = mediaRecorder;
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.stop();
  await stopped;

  const mimeType = recorder.mimeType || 'video/webm';
  const blob = new Blob(recordedChunks, { type: mimeType });
  const durationMs = Date.now() - startTime;
  const url = URL.createObjectURL(blob); // stays alive with this document — do not revoke before download
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

  await cleanup();

  const filename = recordingFilename(startTime, ext);
  const resp = await chrome.runtime
    .sendMessage({ type: 'KS_RECORDING_READY', url, filename, size: blob.size, durationMs })
    .catch(() => null);
  if (!(resp as { ok?: boolean } | null)?.ok) {
    // Background couldn't run downloads.download — save straight from this
    // document instead (an anchor click needs no extra permissions).
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').pop() ?? 'keepsake-recording.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

async function cleanup(): Promise<void> {
  for (const stream of [recorderStream, mediaStream, microphoneStream]) {
    stream?.getTracks().forEach((t) => t.stop());
  }
  recorderStream = mediaStream = microphoneStream = null;
  mediaRecorder = null;
  recordedChunks = [];
  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }
}
