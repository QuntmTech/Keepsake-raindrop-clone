import { storage } from 'wxt/utils/storage';
import { type Backend } from './types';
import { LocalBackend } from './local';
import { PocketBaseBackend } from './pocketbase';
import { HOSTED } from '../config';

export type BackendMode = 'local' | 'pocketbase';

// Re-export so UI can gate on it (`import { HOSTED } from '@/lib/backend'`).
export { HOSTED };

// In a published build a server URL is baked in → default everyone to the hosted
// cloud backend (real accounts, synced storage, zero setup). With no URL, default
// to local so it still works offline.
const modeStore = storage.defineItem<BackendMode>('sync:backend_mode', {
  fallback: HOSTED ? 'pocketbase' : 'local',
});

export async function getBackendMode(): Promise<BackendMode> {
  // A hosted/commercial build always uses the cloud backend — ignore any stale
  // stored 'local' value (e.g. left over from earlier testing), which would
  // otherwise make cloud logins fail against the wrong (local) account.
  if (HOSTED) return 'pocketbase';
  return modeStore.getValue();
}

export async function setBackendMode(mode: BackendMode): Promise<void> {
  await modeStore.setValue(mode);
  instance = null; // force re-init with the new backend on next access
}

export function watchBackendMode(cb: (m: BackendMode) => void): () => void {
  return modeStore.watch((v) => cb(v ?? 'local'));
}

let instance: Backend | null = null;
let initPromise: Promise<Backend> | null = null;

// Resolve the active backend, initializing (loading session) exactly once.
export async function getBackend(): Promise<Backend> {
  if (instance) return instance;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const mode = HOSTED ? 'pocketbase' : await modeStore.getValue();
    const backend: Backend = mode === 'pocketbase' ? new PocketBaseBackend() : new LocalBackend();
    await backend.init();
    instance = backend;
    initPromise = null;
    return backend;
  })();
  return initPromise;
}
