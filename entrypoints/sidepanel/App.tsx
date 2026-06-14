import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LoginForm } from '@/components/LoginForm';
import { SaveForm } from '@/components/SaveForm';
import { BookmarkGrid } from '@/components/BookmarkGrid';
import { AIAssistant } from '@/components/AIAssistant';
import { Icon, type IconName } from '@/components/Icon';
import { searchBookmarks, deleteBookmark, toggleFavorite } from '@/lib/bookmarks';
import { type Bookmark } from '@/lib/types';
import { useToast } from '@/components/Toast';

type Tab = 'save' | 'library' | 'ask';

// The side panel stays docked while you browse.
export default function App() {
  const { ready, authed, login, signup } = useAuth();
  const [tab, setTab] = useState<Tab>('save');

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
        <TabBtn icon="grid" label="Library" active={tab === 'library'} onClick={() => setTab('library')} />
        <TabBtn icon="sparkles" label="Ask" active={tab === 'ask'} onClick={() => setTab('ask')} />
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'save' && <SaveForm onSaved={() => setTab('library')} />}
        {tab === 'library' && <Library />}
        {tab === 'ask' && <AIAssistant />}
      </div>
    </div>
  );
}

function Library() {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  const run = (q: string) => {
    setLoading(true);
    searchBookmarks(q, { perPage: 60 })
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const id = setTimeout(() => run(query), 220);
    return () => clearTimeout(id);
  }, [query]);

  async function remove(id: string) {
    await deleteBookmark(id);
    setItems((p) => p.filter((b) => b.id !== id));
    toast('Deleted', 'info');
  }
  async function fav(b: Bookmark) {
    const updated = await toggleFavorite(b.id, !b.favorite);
    setItems((p) => p.map((x) => (x.id === b.id ? updated : x)));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 bg-surface p-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2.5 focus-within:border-brand/50">
          <Icon name="search" size={16} className="text-ink-faint" />
          <input
            className="flex-1 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-faint"
            placeholder="Search your vault…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 pt-0">
        <BookmarkGrid items={items} loading={loading} view="list" onDelete={remove} onToggleFavorite={fav} />
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
      className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition ${
        active ? 'border-b-2 border-brand text-brand' : 'text-ink-faint hover:text-ink'
      }`}
    >
      <Icon name={icon} size={15} /> {label}
    </button>
  );
}
