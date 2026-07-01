// Browser extensions are several separate programs (background worker, content scripts, UI pages)
// that talk only by passing messages. This file is the single typed contract for those messages,
// so every context agrees on the shape.

import { type HighlightColor } from './types';
import { type PageMeta } from './metadata';
import { type CaptureMessage } from './capture';
import { type WatchConfig } from './watch';

export type Message =
  | { type: 'SAVE_CURRENT_PAGE'; collection?: string }
  | { type: 'CAPTURE_SCREENSHOT' }       // background -> JPEG dataURL of the visible tab
  | { type: 'EXTRACT_META'; tabId?: number } // background -> PageMeta for a tab
  | { type: 'OPEN_DASHBOARD' }
  | { type: 'OPEN_SURFACE'; surface: 'popup' | 'sidepanel' | 'dashboard' }
  | { type: 'OPEN_QUICKBAR' } // background -> content: pop the quick-save folder picker
  | { type: 'CREATE_HIGHLIGHT'; url: string; text: string; color: HighlightColor; anchor?: string }
  | { type: 'FLUSH_QUEUE' }
  | { type: 'PING' }
  // AI-native core (v8.2)
  | { type: 'KS_AUTOFILE'; id: string; tabId?: number } // run the auto-file pipeline for a fresh save
  | { type: 'KS_GET_RECALL'; tabId?: number } // Ambient Recall matches for a tab
  | { type: 'KS_WATCH_START'; saveId: string; cfg: WatchConfig }
  | { type: 'KS_WATCH_STOP'; saveId: string }
  | { type: 'KS_PICK_SELECTOR' } // element picker on the active tab -> CSS selector
  | CaptureMessage; // screenshots + screen recording (see lib/capture.ts)

export interface ScreenshotResult {
  dataUrl: string;
}

export interface MetaResult {
  meta: PageMeta | null;
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
