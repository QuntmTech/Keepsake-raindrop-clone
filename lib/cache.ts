import { storage } from 'wxt/utils/storage';
import { type Bookmark, type Collection } from './types';
import { HOSTED } from './config';

// Instant-load cache. We persist the last-seen "all bookmarks" view + collections
// so the popup/dashboard paint immediately on open, then refresh from the server
// in the background (stale-while-revalidate). Keyed by user id so accounts never
// see each other's cached data.
export interface VaultSnapshot {
  uid: string;
  bookmarks: Bookmark[];
  collections: Collection[];
  counts: Record<string, number>;
  ts: number;
}

const item = storage.defineItem<VaultSnapshot | null>('local:vault_snapshot', { fallback: null });

export async function readSnapshot(uid: string | null): Promise<VaultSnapshot | null> {
  if (!HOSTED || !uid) return null; // local mode is already instant
  const s = await item.getValue();
  return s && s.uid === uid ? s : null;
}

export async function writeSnapshot(s: Omit<VaultSnapshot, 'ts'>): Promise<void> {
  if (!HOSTED || !s.uid) return;
  await item.setValue({ ...s, ts: Date.now() });
}

export async function clearSnapshot(): Promise<void> {
  await item.setValue(null);
}
