import { useEffect, useState } from 'react';
import { loadAuth, isLoggedIn, currentUser, watchAuth, refreshUserPlan, login as doLogin, signup as doSignup, logout as doLogout } from '@/lib/auth';
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
    (async () => {
      mark('init');
      await loadAuth();
      mark('auth');
      setAuthed(await isLoggedIn());
      const u = await currentUser();
      setEmail(u?.email ?? null);
      setPlan(u?.plan ?? 'free');
      setReady(true);
      mark('ready');
    })();
  }, []);

  // Re-read plan/email whenever the auth record changes in ANY context — e.g.
  // a completed Stripe upgrade lands via the webhook, and a background
  // refreshUser() call (Phase 3) picks it up and mirrors it here live, without
  // requiring this surface to reload.
  useEffect(() => {
    return watchAuth(() => {
      isLoggedIn().then(setAuthed);
      currentUser().then((u) => {
        setEmail(u?.email ?? null);
        setPlan(u?.plan ?? 'free');
      });
    });
  }, []);

  // Catch upgrades made OUTSIDE the extension (e.g. on the keepsaketab.com web
  // checkout): when this surface regains focus, force a fresh plan read so an
  // already-open new tab / dashboard reflects Pro within seconds instead of
  // waiting for the 6h background refresh. Throttled to at most once/minute so
  // rapid tab-switching doesn't hammer the server; only runs while signed in.
  useEffect(() => {
    if (!authed) return;
    let last = 0;
    // Only refresh after the tab has ACTUALLY been left and returned to — a
    // genuine re-focus always has a preceding blur / tab-hide; the initial
    // new-tab mount fires focus/visible with none. Without this `away` guard,
    // every single new tab kicked off a needless authRefresh network call on
    // open (the mount already read the plan via loadAuth). Still throttled so
    // rapid away/return switching doesn't hammer the server.
    let away = false;
    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!away) return; // no genuine leave happened → not a re-focus
      away = false;
      const now = Date.now();
      if (now - last < 60_000) return;
      last = now;
      refreshUserPlan()
        .then((u) => {
          if (u) {
            setEmail(u.email);
            setPlan(u.plan);
          }
        })
        .catch(() => {});
    };
    const markAway = () => {
      away = true;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') markAway();
      else refresh();
    };
    window.addEventListener('blur', markAway);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', markAway);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [authed]);

  async function login(em: string, password: string) {
    const u = await doLogin(em, password);
    setAuthed(true);
    setEmail(u.email);
    setPlan(u.plan);
  }

  async function signup(em: string, password: string, name?: string) {
    const u = await doSignup(em, password, name);
    setAuthed(true);
    setEmail(u.email);
    setPlan(u.plan);
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
