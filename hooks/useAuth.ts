import { useEffect, useState } from 'react';
import { loadAuth, isLoggedIn, currentUser, watchAuth, login as doLogin, signup as doSignup, logout as doLogout } from '@/lib/auth';
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
