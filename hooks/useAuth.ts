import { useEffect, useState } from 'react';
import {
  loadAuth,
  isLoggedIn,
  currentUser,
  readCachedAuthUser,
  watchAuth,
  refreshUserPlan,
  login as doLogin,
  signup as doSignup,
  logout as doLogout,
} from '@/lib/auth';
import { mark } from '@/lib/boottrace';
import { clearSnapshot } from '@/lib/cache';
import { type Plan } from '@/lib/types';

// Tiny auth hook shared by every UI surface. Backend-agnostic.
export function useAuth() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>('free');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      mark('init');

      // The local mirror is enough to paint the last known signed-in Home shell.
      // PocketBase still initializes immediately afterward and remains authoritative.
      const cached = await readCachedAuthUser();
      if (cached && !cancelled) {
        setAuthed(true);
        setEmail(cached.email);
        setPlan(cached.plan);
        setReady(true);
        mark('ready:cache');
      }

      try {
        await loadAuth();
        mark('auth');
        const [loggedIn, user] = await Promise.all([isLoggedIn(), currentUser()]);
        if (cancelled) return;
        setAuthed(loggedIn);
        setEmail(user?.email ?? null);
        setPlan(user?.plan ?? 'free');
      } catch {
        // Offline or a temporarily unavailable backend must not leave Home on an
        // endless splash screen. Cached content remains usable where available.
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

  // Re-read plan/email whenever the auth record changes in ANY context — e.g.
  // a completed Stripe upgrade lands via the webhook.
  useEffect(() => {
    return watchAuth(() => {
      isLoggedIn().then(setAuthed);
      currentUser().then((user) => {
        setEmail(user?.email ?? null);
        setPlan(user?.plan ?? 'free');
      });
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
    setAuthed(true);
    setEmail(user.email);
    setPlan(user.plan);
  }

  async function signup(em: string, password: string, name?: string) {
    const user = await doSignup(em, password, name);
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
