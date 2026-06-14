import PocketBase, { type AuthRecord } from 'pocketbase';
import { storage } from 'wxt/storage';

// PocketBase = your backend. Think of it as a tiny Firebase you host yourself:
// a database + auth + file storage, all behind one URL.

const PB_URL = import.meta.env.WXT_PB_URL ?? 'http://127.0.0.1:8090';

// One shared client for the whole extension context.
export const pb = new PocketBase(PB_URL);

// PocketBase normally saves the login token to localStorage. Extensions don't have a
// reliable shared localStorage across contexts, so we mirror the auth into chrome.storage
// (via WXT's storage helper) so popup, side panel, dashboard, and background all stay logged in.
const authStore = storage.defineItem<string | null>('local:pb_auth', {
  fallback: null,
});

// Call this once at the top of every entrypoint before using `pb`.
export async function loadAuth(): Promise<void> {
  const saved = await authStore.getValue();
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      pb.authStore.save(parsed.token, parsed.record);
    } catch {
      await authStore.setValue(null);
    }
  }
  // Persist any future auth changes back to chrome.storage.
  pb.authStore.onChange(() => {
    const snapshot = pb.authStore.isValid
      ? JSON.stringify({ token: pb.authStore.token, record: pb.authStore.record })
      : null;
    authStore.setValue(snapshot);
  });
}

export async function login(email: string, password: string): Promise<AuthRecord> {
  const res = await pb.collection('users').authWithPassword(email, password);
  return res.record;
}

export async function logout(): Promise<void> {
  pb.authStore.clear();
  await authStore.setValue(null);
}

export function currentUserId(): string | null {
  return pb.authStore.record?.id ?? null;
}

export function isLoggedIn(): boolean {
  return pb.authStore.isValid;
}

// Build a public file URL for a stored cover/screenshot.
export function fileUrl(record: { id: string; collectionId: string }, filename: string): string {
  return `${PB_URL}/api/files/${record.collectionId}/${record.id}/${filename}`;
}
