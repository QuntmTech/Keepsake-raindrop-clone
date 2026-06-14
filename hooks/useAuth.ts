import { useEffect, useState } from 'react';
import { loadAuth, isLoggedIn, login as pbLogin, logout as pbLogout } from '@/lib/pocketbase';

// Tiny auth hook shared by every UI surface.
export function useAuth() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    loadAuth().then(() => {
      setAuthed(isLoggedIn());
      setReady(true);
    });
  }, []);

  async function login(email: string, password: string) {
    await pbLogin(email, password);
    setAuthed(true);
  }

  async function logout() {
    await pbLogout();
    setAuthed(false);
  }

  return { ready, authed, login, logout };
}
