// Browser extensions are 3 separate programs (background worker, content scripts, UI pages)
// that talk only by passing messages. This file is the single typed contract for those messages,
// so every context agrees on the shape.

import { type HighlightColor } from './types';

export type Message =
  | { type: 'SAVE_CURRENT_PAGE'; collection?: string }
  | { type: 'CAPTURE_SCREENSHOT' } // background -> returns a JPEG dataURL of the visible tab
  | { type: 'OPEN_DASHBOARD' }
  | { type: 'CREATE_HIGHLIGHT'; url: string; text: string; color: HighlightColor; anchor?: string }
  | { type: 'PING' };

export interface ScreenshotResult {
  dataUrl: string;
}

// Thin wrapper so callers get types instead of `any`.
export async function send<T = unknown>(msg: Message): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

// Convert a dataURL (what captureVisibleTab returns) into a Blob for PocketBase upload.
export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
