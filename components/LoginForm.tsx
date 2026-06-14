import { useState } from 'react';

export function LoginForm({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (e: any) {
      setError(e?.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold">Sign in</h2>
      <input
        className="rounded border border-gray-300 px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="rounded border border-gray-300 px-3 py-2 text-sm dark:bg-gray-800 dark:border-gray-700"
        placeholder="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        className="rounded bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        onClick={submit}
        disabled={busy}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </div>
  );
}
