import { getAiSettings } from './ai';

export interface TranscriptionProgress {
  completedChunks: number;
  totalChunks: number;
  percent: number;
  transcript: string;
}

export interface TranscriptionResult {
  text: string;
  durationSeconds: number;
  chunks: number;
}

export interface TranscriptionOptions {
  hotwords?: string[];
  prompt?: string;
  signal?: AbortSignal;
  onProgress?: (progress: TranscriptionProgress) => void;
}

const CHUNK_SECONDS = 25;
const TARGET_SAMPLE_RATE = 16_000;
const MAX_DURATION_SECONDS = 3 * 60 * 60;
const MAX_FILE_BYTES = 300 * 1024 * 1024;

function abortSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(75_000);
  const any = (AbortSignal as any).any as ((signals: AbortSignal[]) => AbortSignal) | undefined;
  return signal && any ? any([signal, timeout]) : signal ?? timeout;
}

function cleanHotwords(values: string[] = []): string[] {
  return [...new Set(values.map((value) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).filter(Boolean))].slice(0, 100);
}

function pcmSample(buffer: AudioBuffer, sourcePosition: number): number {
  const left = Math.max(0, Math.min(buffer.length - 1, Math.floor(sourcePosition)));
  const right = Math.min(buffer.length - 1, left + 1);
  const fraction = sourcePosition - left;
  let value = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    value += data[left] + (data[right] - data[left]) * fraction;
  }
  return Math.max(-1, Math.min(1, value / Math.max(1, buffer.numberOfChannels)));
}

function encodeWavChunk(buffer: AudioBuffer, startSeconds: number, durationSeconds: number): Uint8Array {
  const samples = Math.max(1, Math.ceil(durationSeconds * TARGET_SAMPLE_RATE));
  const bytes = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  write(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples * 2, true);

  const startSource = startSeconds * buffer.sampleRate;
  const step = buffer.sampleRate / TARGET_SAMPLE_RATE;
  for (let i = 0; i < samples; i++) {
    const sample = pcmSample(buffer, startSource + i * step);
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + size)));
  }
  return btoa(binary);
}

async function decodeAudio(file: File): Promise<AudioBuffer> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Audio files must be 300 MB or smaller.');
  const Context = globalThis.AudioContext ?? (globalThis as any).webkitAudioContext;
  if (!Context) throw new Error('This browser cannot decode audio files.');
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData((await file.arrayBuffer()).slice(0));
    if (!buffer.duration || !Number.isFinite(buffer.duration)) throw new Error('The audio duration could not be read.');
    if (buffer.duration > MAX_DURATION_SECONDS) throw new Error('Audio longer than three hours is not supported in one job.');
    return buffer;
  } finally {
    await context.close().catch(() => {});
  }
}

async function transcribeChunk(
  key: string,
  wav: Uint8Array,
  prompt: string,
  hotwords: string[],
  signal?: AbortSignal,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch('https://api.novita.ai/v3/glm-asr', {
        method: 'POST',
        signal: abortSignal(signal),
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          file: bytesToBase64(wav),
          ...(prompt ? { prompt: prompt.slice(-8000) } : {}),
          ...(hotwords.length ? { hotwords } : {}),
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) throw new Error('Invalid Novita API key.');
        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`Novita transcription is temporarily unavailable (${response.status}).`);
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
            continue;
          }
        }
        throw new Error(`Transcription failed (${response.status}) ${detail.slice(0, 160)}`.trim());
      }
      const data = (await response.json()) as { text?: string };
      return data.text?.trim() ?? '';
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw new DOMException('Transcription cancelled', 'AbortError');
      const name = (error as { name?: string })?.name;
      if ((name === 'TimeoutError' || error instanceof TypeError) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Transcription failed.');
}

export async function transcribeAudioFile(file: File, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
  const settings = await getAiSettings();
  if (!settings.enabled || settings.provider !== 'novita' || !settings.apiKey.trim()) {
    throw new Error('Choose Novita AI and add its API key in Settings before transcribing audio.');
  }

  const buffer = await decodeAudio(file);
  const totalChunks = Math.max(1, Math.ceil(buffer.duration / CHUNK_SECONDS));
  const hotwords = cleanHotwords(options.hotwords);
  const parts: string[] = [];

  for (let index = 0; index < totalChunks; index++) {
    if (options.signal?.aborted) throw new DOMException('Transcription cancelled', 'AbortError');
    const start = index * CHUNK_SECONDS;
    const duration = Math.min(CHUNK_SECONDS, buffer.duration - start);
    const wav = encodeWavChunk(buffer, start, duration);
    const context = [options.prompt?.trim(), parts.slice(-4).join(' ')].filter(Boolean).join('\n').slice(-8000);
    const text = await transcribeChunk(settings.apiKey.trim(), wav, context, hotwords, options.signal);
    if (text) parts.push(text);
    options.onProgress?.({
      completedChunks: index + 1,
      totalChunks,
      percent: Math.round(((index + 1) / totalChunks) * 100),
      transcript: parts.join('\n\n'),
    });
  }

  return { text: parts.join('\n\n').trim(), durationSeconds: buffer.duration, chunks: totalChunks };
}
