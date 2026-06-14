import { storage } from 'wxt/storage';
import { type Settings, DEFAULT_SETTINGS } from './types';

// Settings live in chrome.storage.sync so they roam across the user's Chrome installs.
const settingsItem = storage.defineItem<Settings>('sync:settings', {
  fallback: DEFAULT_SETTINGS,
});

export async function getSettings(): Promise<Settings> {
  return settingsItem.getValue();
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await settingsItem.getValue();
  const next = { ...current, ...patch };
  await settingsItem.setValue(next);
  return next;
}

// React/background can subscribe to live changes (e.g. background re-applies icon behavior).
export function watchSettings(cb: (s: Settings) => void): () => void {
  return settingsItem.watch(cb);
}
