import { useEffect, useState } from 'react';
import { loadAuth, isLoggedIn, currentUser, login as doLogin, signup as doSignup, logout as doLogout } from '@/lib/auth';

// Tiny auth hook shared by every UI surface. Backend-agnostic.
export function useAuth() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await loadAuth();
      setAuthed(await isLoggedIn());
      setEmail((await currentUser())?.email ?? null);
      setReady(true);
    })();
  }, []);

  async function login(em: string, password: string) {
    const u = await doLogin(em, password);
    setAuthed(true);
    setEmail(u.email);
  }

  async function signup(em: string, password: string, name?: string) {
    const u = await doSignup(em, password, name);
    setAuthed(true);
    setEmail(u.email);
  }

  async function logout() {
    await doLogout();
    setAuthed(false);
    setEmail(null);
  }

  return { ready, authed, email, login, signup, logout };
}
