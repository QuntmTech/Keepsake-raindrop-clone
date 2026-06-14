import { storage } from 'wxt/utils/storage';
import { type Backend } from './types';
import { LocalBackend } from './local';
import { PocketBaseBackend } from './pocketbase';

export type BackendMode = 'local' | 'pocketbase';

// Backend mode lives in sync storage so the choice roams with the user.
// Defaults to 'local' so the extension is fully functional with zero setup.
const modeStore = storage.defineItem<BackendMode>('sync:backend_mode', { fallback: 'local' });

export async function getBackendMode(): Promise<BackendMode> {
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
    const mode = await modeStore.getValue();
    const backend: Backend = mode === 'pocketbase' ? new PocketBaseBackend() : new LocalBackend();
    await backend.init();
    instance = backend;
    initPromise = null;
    return backend;
  })();
  return initPromise;
}
