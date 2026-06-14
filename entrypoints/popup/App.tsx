import { useAuth } from '@/hooks/useAuth';
import { LoginForm } from '@/components/LoginForm';
import { SaveForm } from '@/components/SaveForm';
import { send } from '@/lib/messaging';

// The popup is the fast path: save the current page in two clicks.
export default function App() {
  const { ready, authed, login } = useAuth();

  if (!ready) return <Shell><p className="p-4 text-sm text-gray-400">Loading…</p></Shell>;
  if (!authed) return <Shell><LoginForm onLogin={login} /></Shell>;

  return (
    <Shell>
      <SaveForm />
      <div className="flex gap-2 border-t border-gray-100 p-3 dark:border-gray-800">
        <button
          className="flex-1 rounded bg-gray-100 px-2 py-1.5 text-xs dark:bg-gray-800"
          onClick={() => send({ type: 'OPEN_DASHBOARD' })}
        >
          Open dashboard
        </button>
        <button
          className="flex-1 rounded bg-gray-100 px-2 py-1.5 text-xs dark:bg-gray-800"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          Settings
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-80 bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <span className="text-lg">💧</span>
        <span className="text-sm font-semibold">Raindrop Clone</span>
      </div>
      {children}
    </div>
  );
}
