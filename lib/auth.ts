import { getBackend } from './backend';
import { type AuthUser } from './backend/types';

// Auth facade. Routes to whichever backend is active (local or PocketBase).

export type { AuthUser };

export async function loadAuth(): Promise<void> {
  await getBackend(); // getBackend() runs init() which restores the session
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
  return (await getBackend()).isLoggedIn();
}

export async function currentUser(): Promise<AuthUser | null> {
  return (await getBackend()).currentUser();
}
