import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LoginForm } from '@/components/LoginForm';
import { SaveForm } from '@/components/SaveForm';
import { LibraryBrowser } from '@/components/LibraryBrowser';
import { AIWorkbench } from '@/components/AIWorkbench';
import { RecallPanel } from '@/components/RecallPanel';
import { SettingsPanel } from '@/components/SettingsPanel';
import { Icon, type IconName } from '@/components/Icon';
import { send } from '@/lib/messaging';

type Tab = 'save' | 'related' | 'library' | 'ai' | 'settings';

// The side panel stays docked while you browse.
export default function App() {
  const { ready, authed, login, signup } = useAuth();
  const [tab, setTab] = useState<Tab>('save');

  useEffect(() => {
    if (authed) send({ type: 'FLUSH_QUEUE' }).catch(() => {});
  }, [authed]);

  if (!ready) return <p className="p-6 text-center text-sm text-ink-faint">Loading…</p>;
  if (!authed)
    return (
      <div className="h-screen bg-surface">
        <LoginForm onLogin={login} onSignup={signup} compact />
      </div>
    );

  return (
    <div className="flex h-screen flex-col bg-surface text-ink">
      <div className="flex border-b border-line">
        <TabBtn icon="plus" label="Save" active={tab === 'save'} onClick={() => setTab('save')} />
        <TabBtn icon="sparkles" label="This page" active={tab === 'related'} onClick={() => setTab('related')} />
        <TabBtn icon="grid" label="Library" active={tab === 'library'} onClick={() => setTab('library')} />
        <TabBtn icon="edit" label="AI" active={tab === 'ai'} onClick={() => setTab('ai')} />
        <TabBtn icon="settings" label="Settings" active={tab === 'settings'} onClick={() => setTab('settings')} />
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'save' && <SaveForm onSaved={() => setTab('library')} />}
        {tab === 'related' && (
          <div className="h-full overflow-y-auto">
            <RecallPanel />
          </div>
        )}
        {tab === 'library' && <LibraryBrowser autoFocus />}
        {tab === 'ai' && <AIWorkbench onOpenSettings={() => setTab('settings')} />}
        {tab === 'settings' && (
          <div className="h-full overflow-y-auto">
            <SettingsPanel compact />
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition ${
        active ? 'border-b-2 border-brand text-brand' : 'text-ink-faint hover:text-ink'
      }`}
    >
      <Icon name={icon} size={14} /> {label}
    </button>
  );
}
