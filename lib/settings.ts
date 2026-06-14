import { storage } from 'wxt/utils/storage';
import { type Settings, DEFAULT_SETTINGS } from './types';

// Settings live in chrome.storage.sync so they roam across the user's Chrome installs.
const settingsItem = storage.defineItem<Settings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
});

export async function getSettings(): Promise<Settings> {
  // Merge with defaults so fields added in updates are always present.
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await settingsItem.setValue(next);
  return next;
}

// React/background can subscribe to live changes (e.g. background re-applies icon behavior).
export function watchSettings(cb: (s: Settings) => void): () => void {
  return settingsItem.watch((v) => cb({ ...DEFAULT_SETTINGS, ...(v ?? DEFAULT_SETTINGS) }));
}
