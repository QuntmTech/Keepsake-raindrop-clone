import { useEffect, useState } from 'react';
import {
  readCachedAuthUser,
  readVerifiedAuthState,
  watchAuth,
  refreshUserPlan,
  login as doLogin,
  signup as doSignup,
  logout as doLogout,
} from '@/lib/auth';
import { mark } from '@/lib/boottrace';
import { clearSnapshot } from '@/lib/cache';
import { type Plan } from '@/lib/types';

// Tiny auth hook shared by every UI surface. Hosted builds paint from the local
// auth mirror first, then reconcile with the initialized backend immediately.
export function useAuth() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>('free');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      mark('init');

      const cached = await readCachedAuthUser();
      if (cached && !cancelled) {
        setAuthed(true);
        setEmail(cached.email);
        setPlan(cached.plan);
        setReady(true);
        mark('ready:cache');
      }

      try {
        const verified = await readVerifiedAuthState();
        mark('auth');
        if (cancelled) return;
        setAuthed(verified.loggedIn);
        setEmail(verified.user?.email ?? null);
        setPlan(verified.user?.plan ?? 'free');
      } catch {
        // Offline or a temporary backend problem must not trap Home on a splash
        // screen. A valid cached session remains usable until a request proves it
        // invalid; users without a cache get the normal signed-out surface.
      } finally {
        if (!cancelled) {
          setReady(true);
          mark('ready');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Re-read plan/email whenever the mirrored auth record changes in any context.
  useEffect(() => {
    return watchAuth(async () => {
      const cached = await readCachedAuthUser();
      setAuthed(Boolean(cached));
      setEmail(cached?.email ?? null);
      setPlan(cached?.plan ?? 'free');
    });
  }, []);

  // Catch upgrades made outside the extension when this surface regains focus.
  useEffect(() => {
    if (!authed) return;
    let last = 0;
    const maybeRefresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - last < 60_000) return;
      last = now;
      refreshUserPlan()
        .then((user) => {
          if (user) {
            setEmail(user.email);
            setPlan(user.plan);
          }
        })
        .catch(() => {});
    };
    window.addEventListener('focus', maybeRefresh);
    document.addEventListener('visibilitychange', maybeRefresh);
    return () => {
      window.removeEventListener('focus', maybeRefresh);
      document.removeEventListener('visibilitychange', maybeRefresh);
    };
  }, [authed]);

  async function login(em: string, password: string) {
    const user = await doLogin(em, password);
    // Never let a snapshot from a previous account flash under this account.
    await clearSnapshot();
    setAuthed(true);
    setEmail(user.email);
    setPlan(user.plan);
  }

  async function signup(em: string, password: string, name?: string) {
    const user = await doSignup(em, password, name);
    await clearSnapshot();
    setAuthed(true);
    setEmail(user.email);
    setPlan(user.plan);
  }

  async function logout() {
    await doLogout();
    await clearSnapshot();
    setAuthed(false);
    setEmail(null);
    setPlan('free');
  }

  return { ready, authed, email, plan, login, signup, logout };
}
