import { useAuth } from '@/hooks/useAuth';
import { LoginForm } from '@/components/LoginForm';
import { SaveForm } from '@/components/SaveForm';
import { BookmarkGrid } from '@/components/BookmarkGrid';
import { useState } from 'react';

// The side panel stays docked while you browse: save the current page, then scroll your vault.
export default function App() {
  const { ready, authed, login } = useAuth();
  const [tab, setTab] = useState<'save' | 'library'>('save');

  if (!ready) return <p className="p-4 text-sm text-gray-400">Loading…</p>;
  if (!authed)
    return (
      <div className="h-screen bg-white dark:bg-gray-900">
        <LoginForm onLogin={login} />
      </div>
    );

  return (
    <div className="flex h-screen flex-col bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <div className="flex border-b border-gray-100 dark:border-gray-800">
        <TabBtn active={tab === 'save'} onClick={() => setTab('save')}>Save</TabBtn>
        <TabBtn active={tab === 'library'} onClick={() => setTab('library')}>Library</TabBtn>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'save' ? <SaveForm onSaved={() => setTab('library')} /> : <BookmarkGrid columns="single" />}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 text-sm font-medium ${active ? 'border-b-2 border-brand text-brand' : 'text-gray-500'}`}
    >
      {children}
    </button>
  );
}
