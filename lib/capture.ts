// Capture feature (ported from CaptureCraft): screen/tab recording via an MV3
// offscreen document + visible-area and full-page screenshots. This file is
// the shared contract between the UI surfaces, the background worker, and the
// offscreen recorder.

import { storage } from 'wxt/utils/storage';

export type RecordMode = 'tab' | 'desktop'; // desktop = screen OR window (Chrome's picker)

export interface RecordOptions {
  mode: RecordMode;
  microphone: boolean;
  systemAudio: boolean;
}

export interface RecordingState {
  isRecording: boolean;
  mode: RecordMode | null;
  startedAt: number | null; // epoch ms
  tabId: number | null;
}

export const IDLE_RECORDING_STATE: RecordingState = {
  isRecording: false,
  mode: null,
  startedAt: null,
  tabId: null,
};

// Persisted so the state survives service-worker restarts and popup closes.
export const recordingStateStore = storage.defineItem<RecordingState>('local:recording_state', {
  fallback: IDLE_RECORDING_STATE,
});

// UI/background messages (added to the main Message union in lib/messaging.ts).
export type CaptureMessage =
  | { type: 'KS_CAPTURE_VISIBLE' } // screenshot the active tab's viewport -> download
  | { type: 'KS_CAPTURE_FULL' } // full-page scroll-and-stitch screenshot -> download
  | { type: 'KS_CAPTURE_VIEWPORT' } // one tile for the full-page script (content -> background)
  | { type: 'KS_START_RECORDING'; options: RecordOptions }
  | { type: 'KS_STOP_RECORDING' }
  | { type: 'KS_GET_RECORDING_STATE' }
  // offscreen -> background: recording blob is ready at a blob: URL minted in
  // the offscreen document (Blobs don't survive JSON message serialization).
  | { type: 'KS_RECORDING_READY'; url: string; filename: string; size: number; durationMs: number }
  | { type: 'KS_RECORDING_ERROR'; error: string };

// background -> offscreen commands (target discriminates so the background's
// own onMessage handler ignores them).
export type OffscreenCommand =
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_START'; streamId: string; options: RecordOptions }
  | { target: 'ks-offscreen'; type: 'OFFSCREEN_STOP' };

export function recordingFilename(startedAt: number, ext: string): string {
  const d = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `Keepsake/keepsake-recording-${stamp}.${ext}`;
}

export function screenshotFilename(kind: 'visible' | 'full'): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `Keepsake/keepsake-screenshot-${kind}-${stamp}.png`;
}
