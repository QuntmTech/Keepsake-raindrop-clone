// Browser extensions are several separate programs (background worker, content scripts, UI pages)
// that talk only by passing messages. This file is the single typed contract for those messages,
// so every context agrees on the shape.

import { type HighlightColor } from './types';
import { type PageMeta } from './metadata';
import { type CaptureMessage } from './capture';
import { type WatchConfig } from './watch';
import { type WriterAction } from './aiWriterPrompt';

export type SaveCurrentPageStatus = 'saved' | 'duplicate' | 'queued' | 'blocked';

export interface SaveCurrentPageResult {
  ok: boolean;
  status: SaveCurrentPageStatus;
  id?: string;
  title?: string;
  collection?: string;
  error?: string;
}

export interface AiSelectionResult {
  ok: boolean;
  text: string;
  editable: boolean;
  source: 'input' | 'contenteditable' | 'page' | 'none';
  pageUrl: string;
  pageTitle: string;
  error?: string;
}

export interface AiSelectionReplaceResult {
  ok: boolean;
  undoAvailable?: boolean;
  error?: string;
}

export type Message =
  | { type: 'SAVE_CURRENT_PAGE'; collection?: string; explicitCollection?: boolean; force?: boolean }
  | { type: 'DELETE_BOOKMARK'; id: string }
  | { type: 'MOVE_BOOKMARK'; id: string; collection?: string }
  | { type: 'REFRESH_BOOKMARK'; id: string; url: string }
  | { type: 'CAPTURE_SCREENSHOT' }       // background -> JPEG dataURL of the visible tab
  | { type: 'EXTRACT_META'; tabId?: number } // background -> PageMeta for a tab
  | { type: 'OPEN_DASHBOARD' }
  | { type: 'OPEN_POPUP' } // content Quick Bar -> toolbar action dropdown
  | { type: 'OPEN_URL'; url: string } // validated http(s) custom Quick Bar shortcut
  | { type: 'OPEN_SURFACE'; surface: 'popup' | 'sidepanel' | 'dashboard' }
  | { type: 'OPEN_QUICKBAR' } // background -> content: pop the quick-save folder picker
  | { type: 'OPEN_AI_TOOLS'; text?: string; action?: WriterAction; source?: 'quickbar' | 'embedded' | 'context-menu' }
  | { type: 'KS_AI_SELECTION_GET' }
  | { type: 'KS_AI_SELECTION_REPLACE'; text: string; expectedOriginal: string }
  | { type: 'KS_AI_SELECTION_UNDO' }
  | { type: 'CREATE_HIGHLIGHT'; url: string; text: string; color: HighlightColor; anchor?: string }
  | { type: 'FLUSH_QUEUE' }
  | { type: 'PING' }
  // AI-native core (v8.2)
  | { type: 'KS_AUTOFILE'; id: string; tabId?: number }
  | { type: 'KS_GET_RECALL'; tabId?: number }
  | { type: 'KS_WATCH_START'; saveId: string; cfg: WatchConfig }
  | { type: 'KS_WATCH_STOP'; saveId: string }
  | { type: 'KS_PICK_SELECTOR' }
  // Home overlay single-writer: every context routes overlay mutations through
  // the background so concurrent writes can't clobber each other (lib/home.ts).
  | {
      type: 'KS_OVERLAY_WRITE';
      user: string;
      id: string;
      dropped: { pinned?: boolean; sort?: number; homeOnly?: boolean };
      verified: ('pinned' | 'sort' | 'homeOnly')[];
    }
  | { type: 'KS_OVERLAY_FORGET'; user: string; id: string }
  | { type: 'KS_START_CHECKOUT'; interval: 'month' | 'year' }
  | { type: 'KS_OPEN_BILLING_PORTAL' }
  | CaptureMessage;

export interface ScreenshotResult {
  dataUrl: string;
}

export interface MetaResult {
  meta: PageMeta | null;
}

export async function send<T = unknown>(msg: Message): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'image/jpeg';
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
