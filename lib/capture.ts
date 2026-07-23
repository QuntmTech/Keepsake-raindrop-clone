// Capture Studio shared contract. Screenshot pixels are always captured at the
// browser's native device scale; recording profiles control encoder constraints
// without changing the page itself.

import { storage } from 'wxt/utils/storage';

export type RecordMode = 'tab' | 'desktop';
export type RecordQuality = '720p' | '1080p' | '1440p' | '4k';
export type RecordFps = 30 | 60;
export type CaptureSelectionMode = 'region' | 'element';
export type ScreenshotKind = 'visible' | 'full' | 'region' | 'element';

export interface RecordOptions {
  mode: RecordMode;
  microphone: boolean;
  systemAudio: boolean;
  quality: RecordQuality;
  fps: RecordFps;
  countdownSeconds?: 0 | 3 | 5;
}

export interface CapturePreferences {
  microphone: boolean;
  systemAudio: boolean;
  quality: RecordQuality;
  fps: RecordFps;
  countdownSeconds: 0 | 3 | 5;
}

export const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  microphone: false,
  systemAudio: true,
  quality: '1080p',
  fps: 30,
  countdownSeconds: 0,
};

export const capturePreferencesStore = storage.defineItem<CapturePreferences>('sync:capture_preferences', {
  fallback: DEFAULT_CAPTURE_PREFERENCES,
});

export interface RecordingState {
  isRecording: boolean;
  paused: boolean;
  mode: RecordMode | null;
  startedAt: number | null;
  pausedAt: number | null;
  pausedDurationMs: number;
  tabId: number | null;
  quality: RecordQuality | null;
  fps: RecordFps | null;
}

export const IDLE_RECORDING_STATE: RecordingState = {
  isRecording: false,
  paused: false,
  mode: null,
  startedAt: null,
  pausedAt: null,
  pausedDurationMs: 0,
  tabId: null,
  quality: null,
  fps: null,
};

export function normalizeRecordingState(value?: Partial<RecordingState> | null): RecordingState {
  return { ...IDLE_RECORDING_STATE, ...(value ?? {}) };
}

// Persisted so the state survives service-worker restarts and popup closes.
export const recordingStateStore = storage.defineItem<RecordingState>('local:recording_state', {
  fallback: IDLE_RECORDING_STATE,
});

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface ImageAnalysis {
  width: number;
  height: number;
  opaqueRatio: number;
  luminanceRange: number;
  blank: boolean;
}

export interface RecordProfile {
  width: number;
  height: number;
  fps: RecordFps;
  bitrate: number;
}

export function resolveRecordProfile(quality: RecordQuality, fps: RecordFps): RecordProfile {
  const dimensions: Record<RecordQuality, [number, number]> = {
    '720p': [1280, 720],
    '1080p': [1920, 1080],
    '1440p': [2560, 1440],
    '4k': [3840, 2160],
  };
  const [width, height] = dimensions[quality];
  const pixelsPerSecond = width * height * fps;
  // Roughly 0.085 bits per pixel per frame, bounded so text stays crisp without
  // producing absurd files. MediaRecorder may choose a lower rate if hardware
  // cannot sustain the requested profile.
  const bitrate = Math.max(4_000_000, Math.min(38_000_000, Math.round(pixelsPerSecond * 0.085)));
  return { width, height, fps, bitrate };
}

// UI/background messages (added to the main Message union in lib/messaging.ts).
export type CaptureMessage =
  | { type: 'KS_CAPTURE_VISIBLE' }
  | { type: 'KS_CAPTURE_FULL' }
  | { type: 'KS_CAPTURE_REGION'; mode: CaptureSelectionMode }
  | { type: 'KS_CAPTURE_VIEWPORT' }
  | { type: 'KS_START_RECORDING'; options: RecordOptions }
  | { type: 'KS_PAUSE_RECORDING' }
  | { type: 'KS_RESUME_RECORDING' }
  | { type: 'KS_STOP_RECORDING' }
  | { type: 'KS_GET_RECORDING_STATE' }
  | { type: 'KS_RECORDING_READY'; url: string; filename: string; size: number; durationMs: number }
  | { type: 'KS_RECORDING_ERROR'; error: string };

// Background -> offscreen commands. The runtime API is the only extension API
// available inside an MV3 offscreen document, so image crop/analysis and video
// encoding live behind this message boundary.
export type OffscreenCommand =
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_START'; streamId: string; options: RecordOptions }
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_PAUSE' }
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_RESUME' }
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_STOP' }
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_GET_STATE' }
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_ANALYZE_IMAGE'; dataUrl: string }
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_CROP_IMAGE'; dataUrl: string; rect: CaptureRect };

export function recordingFilename(startedAt: number, ext: string): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `Keepsake/keepsake-recording-${stamp}.${ext}`;
}

export function screenshotFilename(kind: ScreenshotKind): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `Keepsake/keepsake-screenshot-${kind}-${stamp}.png`;
}
