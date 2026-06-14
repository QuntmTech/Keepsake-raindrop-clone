import { useAuth } from '@/hooks/useAuth';
import { LoginForm } from '@/components/LoginForm';
import { BookmarkGrid } from '@/components/BookmarkGrid';

// The dashboard is the full-page library — opens in its own tab.
export default function App() {
  const { ready, authed, login, logout } = useAuth();

  if (!ready) return <p className="p-8 text-gray-400">Loading…</p>;

  if (!authed)
    return (
      <div className="mx-auto mt-24 max-w-sm rounded-xl border border-gray-200 dark:border-gray-700">
        <LoginForm onLogin={login} />
      </div>
    );

  return (
    <div className="flex h-screen flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-xl">💧</span>
          <h1 className="text-lg font-semibold">My Vault</h1>
        </div>
        <div className="flex items-center gap-3">
          <button className="text-sm text-gray-500" onClick={() => browser.runtime.openOptionsPage()}>
            Settings
          </button>
          <button className="text-sm text-gray-500" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 overflow-hidden">
        <BookmarkGrid columns="auto" />
      </main>
    </div>
  );
}
