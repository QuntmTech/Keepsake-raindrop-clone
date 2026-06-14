import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LoginForm } from '@/components/LoginForm';
import { SaveForm } from '@/components/SaveForm';
import { Icon } from '@/components/Icon';
import { Favicon } from '@/components/Favicon';
import { send } from '@/lib/messaging';
import { recentBookmarks } from '@/lib/bookmarks';
import { type Bookmark } from '@/lib/types';

// The popup is the fast path: save the current page in two clicks.
export default function App() {
  const { ready, authed, login, signup } = useAuth();
  const [recent, setRecent] = useState<Bookmark[]>([]);

  const loadRecent = () => recentBookmarks(3).then(setRecent).catch(() => {});
  useEffect(() => {
    if (authed) {
      loadRecent();
      // Opportunistically retry any saves that were queued while offline.
      send({ type: 'FLUSH_QUEUE' }).catch(() => {});
    }
  }, [authed]);

  if (!ready) return <Shell><Loading /></Shell>;
  if (!authed) return <Shell><LoginForm onLogin={login} onSignup={signup} compact /></Shell>;

  return (
    <Shell>
      <SaveForm onSaved={loadRecent} />

      {recent.length > 0 && (
        <div className="border-t border-line px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Recently saved
          </p>
          <div className="flex flex-col gap-1">
            {recent.map((b) => (
              <a
                key={b.id}
                href={b.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-sunken"
              >
                <Favicon src={b.favicon} size={16} />
                <span className="truncate text-xs text-ink-soft">{b.title}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 border-t border-line p-3">
        <button className="btn-outline flex-1 py-1.5 text-xs" onClick={() => send({ type: 'OPEN_DASHBOARD' })}>
          <Icon name="grid" size={14} /> Dashboard
        </button>
        <button className="btn-outline flex-1 py-1.5 text-xs" onClick={() => browser.runtime.openOptionsPage()}>
          <Icon name="settings" size={14} /> Settings
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[22rem] bg-surface text-ink">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white">
          <Icon name="bookmark" size={16} fill />
        </span>
        <span className="text-sm font-semibold">Keepsake</span>
      </div>
      {children}
    </div>
  );
}

function Loading() {
  return <p className="p-6 text-center text-sm text-ink-faint">Loading…</p>;
}
