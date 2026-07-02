import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { getBackendMode, setBackendMode, HOSTED, type BackendMode } from '@/lib/backend';

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
  onSignup?: (email: string, password: string, name?: string) => Promise<void>;
  compact?: boolean;
  // Fresh installs land on sign-up; everyone else defaults to sign-in.
  defaultMode?: 'login' | 'signup';
}

export function LoginForm({ onLogin, onSignup, compact, defaultMode }: Props) {
  const [mode, setMode] = useState<'login' | 'signup'>(defaultMode ?? 'login');

  // The default can arrive async (onboarding stage is read from storage after
  // this form mounts) — follow it until the user picks a mode themselves.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (defaultMode && !touched) setMode(defaultMode);
  }, [defaultMode, touched]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [backend, setBackend] = useState<BackendMode>('local');

  useEffect(() => {
    getBackendMode().then(setBackend);
  }, []);

  async function submit() {
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup' && onSignup) await onSignup(email, password);
      else await onLogin(email, password);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-3 ${compact ? 'p-4' : 'p-6'}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
          <Icon name="bookmark" size={18} fill />
        </span>
        <div>
          <h2 className="text-base font-semibold text-ink">
            {mode === 'login' ? 'Welcome back' : 'Create your vault'}
          </h2>
          <p className="text-xs text-ink-faint">Keepsake — your bookmarks, supercharged</p>
        </div>
      </div>

      <input
        className="input"
        placeholder="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <input
        className="input"
        placeholder="Password"
        type="password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}

      <button className="btn-primary" onClick={submit} disabled={busy}>
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>

      {onSignup && (
        <button
          className="text-xs text-ink-faint transition hover:text-brand"
          onClick={() => {
            setTouched(true);
            setMode((m) => (m === 'login' ? 'signup' : 'login'));
            setError('');
          }}
        >
          {mode === 'login'
            ? "Don't have an account? Sign up"
            : 'Already have an account? Sign in'}
        </button>
      )}

      {!HOSTED && backend === 'pocketbase' && (
        <div className="mt-2 rounded-lg border border-line bg-surface-sunken p-2.5 text-xs text-ink-soft">
          You're connected to a <b>PocketBase server</b>. If you can't sign in (no server set up),
          switch back to on-device storage:
          <button
            className="mt-1.5 w-full rounded-md bg-ink/5 py-1.5 font-medium text-brand hover:bg-ink/10"
            onClick={async () => {
              await setBackendMode('local');
              location.reload();
            }}
          >
            Use on-device storage
          </button>
        </div>
      )}
    </div>
  );
}
