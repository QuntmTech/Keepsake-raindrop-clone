import { storage } from 'wxt/utils/storage';
import { getBackend, HOSTED } from './backend';
import { type AuthUser } from './backend/types';

// Auth facade. Routes to whichever backend is active (local or PocketBase).
// Hosted builds also keep a tiny local mirror so Home can paint immediately
// instead of waiting for backend construction on every new tab.

export type { AuthUser };

const authMirror = storage.defineItem<string | null>('local:pb_auth', { fallback: null });

function tokenIsFresh(token: string): boolean {
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return true;
  try {
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return !payload.exp || payload.exp * 1000 > Date.now() + 5_000;
  } catch {
    // PocketBase currently uses JWTs, but a future token format must not make
    // startup fail. The initialized backend remains the final authority.
    return true;
  }
}

export async function readCachedAuthUser(): Promise<AuthUser | null> {
  if (!HOSTED) return null;
  const raw = await authMirror.getValue();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      token?: string;
      record?: { id?: string; email?: string; name?: string; plan?: string };
    };
    if (!parsed.token || !tokenIsFresh(parsed.token) || !parsed.record?.id) return null;
    const plan = parsed.record.plan === 'owner' || parsed.record.plan === 'pro' ? parsed.record.plan : 'free';
    return {
      id: parsed.record.id,
      email: parsed.record.email ?? '',
      name: parsed.record.name,
      plan,
    };
  } catch {
    return null;
  }
}

export async function loadAuth(): Promise<void> {
  await getBackend(); // getBackend() runs init() which restores the session
}

// Used after the fast cached paint. This bypasses the local shortcut so the UI
// always settles on the state owned by the initialized backend.
export async function readVerifiedAuthState(): Promise<{ loggedIn: boolean; user: AuthUser | null }> {
  const backend = await getBackend();
  const loggedIn = await Promise.resolve(backend.isLoggedIn());
  const user = await Promise.resolve(backend.currentUser());
  return { loggedIn, user: loggedIn ? user : null };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return (await getBackend()).login(email, password);
}

export async function signup(email: string, password: string, name?: string): Promise<AuthUser> {
  return (await getBackend()).signup(email, password, name);
}

export async function logout(): Promise<void> {
  return (await getBackend()).logout();
}

// Whether the active backend supports emailed password resets (PocketBase yes,
// local no) — lets the login form show the link only when it'll work.
export async function canResetPassword(): Promise<boolean> {
  return typeof (await getBackend()).requestPasswordReset === 'function';
}

export async function requestPasswordReset(email: string): Promise<void> {
  const backend = await getBackend();
  if (!backend.requestPasswordReset) throw new Error('Password reset is not available for on-device storage.');
  return backend.requestPasswordReset(email);
}

export async function isLoggedIn(): Promise<boolean> {
  const cached = await readCachedAuthUser();
  if (cached) return true;
  return (await getBackend()).isLoggedIn();
}

export async function currentUser(): Promise<AuthUser | null> {
  const cached = await readCachedAuthUser();
  if (cached) return cached;
  return (await getBackend()).currentUser();
}

// Force a fresh read of the signed-in user record from the server (bypassing
// the background refresh throttle), to catch a plan change made elsewhere.
export async function refreshUserPlan(): Promise<AuthUser | null> {
  const backend = await getBackend();
  if (backend.refreshUser) {
    const fresh = await backend.refreshUser().catch(() => null);
    if (fresh) return fresh;
  }
  return backend.currentUser();
}

// Hosted auth changes are already mirrored through chrome.storage. Watching the
// mirror directly avoids constructing PocketBase solely to register a listener.
export function watchAuth(cb: () => void): () => void {
  if (HOSTED) return authMirror.watch(() => cb());

  let unsub = () => {};
  let cancelled = false;
  getBackend().then((backend) => {
    if (cancelled) return;
    unsub = backend.watchAuthChange?.(cb) ?? (() => {});
  });
  return () => {
    cancelled = true;
    unsub();
  };
}
