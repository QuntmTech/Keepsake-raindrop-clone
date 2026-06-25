import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useCollections } from '@/hooks/useCollections';
import { LoginForm } from '@/components/LoginForm';
import { BookmarkGrid } from '@/components/BookmarkGrid';
import { Favicon } from '@/components/Favicon';
import { Icon } from '@/components/Icon';
import { searchBookmarks, recentBookmarks, markVisited } from '@/lib/bookmarks';
import { type Bookmark } from '@/lib/types';

// Keepsake Home — replaces the new-tab page with a start screen powered by your
// vault: search, favorites speed-dial, collections, and recent saves.
export default function App() {
  const { ready, authed, email, login, signup } = useAuth();
  const { settings } = useSettings();
  const c = useCollections(authed);

  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Bookmark[] | null>(null);
  const [favorites, setFavorites] = useState<Bookmark[]>([]);
  const [recent, setRecent] = useState<Bookmark[]>([]);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!authed) return;
    searchBookmarks('', { favorite: true, perPage: 12 }).then(setFavorites).catch(() => {});
    recentBookmarks(12).then(setRecent).catch(() => {});
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const id = setTimeout(() => {
      const q = query.trim();
      if (!q) {
        setResults(null);
        return;
      }
      searchBookmarks(q, { perPage: 30 }).then(setResults).catch(() => setResults([]));
    }, 160);
    return () => clearTimeout(id);
  }, [query, authed]);

  const greeting = useMemo(() => {
    const h = now.getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, [now]);
  const name = email ? email.split('@')[0] : '';
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const dashUrl = (hash = '') => browser.runtime.getURL('/dashboard.html') + hash;
  const open = (b: Bookmark) => {
    markVisited(b.id);
    window.location.href = b.url;
  };
  const webSearch = () => {
    window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  };

  if (!ready) return <div className="grid h-screen place-items-center text-ink-faint">Loading…</div>;

  if (!authed) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-sunken">
        <div className="card w-full max-w-sm">
          <LoginForm onLogin={login} onSignup={signup} />
        </div>
      </div>
    );
  }

  const minimal = settings.newTabMode === 'minimal';

  return (
    <div className="min-h-screen bg-surface-sunken text-ink">
      {/* top bar */}
      <header className="flex items-center gap-2 px-6 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
          <Icon name="bookmark" size={17} fill />
        </span>
        <span className="text-base font-semibold">Keepsake</span>
        <div className="ml-auto flex items-center gap-1.5">
          <a className="btn-ghost px-2" href={dashUrl()} title="Open dashboard">
            <Icon name="grid" size={18} />
          </a>
          <button className="btn-ghost px-2" onClick={() => browser.runtime.openOptionsPage()} title="Settings">
            <Icon name="settings" size={18} />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 pb-20">
        {/* greeting + clock */}
        <div className="mt-[8vh] text-center">
          <p className="text-5xl font-semibold tracking-tight">{time}</p>
          <p className="mt-2 text-lg text-ink-soft">
            {greeting}
            {name ? `, ${name}` : ''}.
          </p>
        </div>

        {/* search */}
        <div className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border border-line bg-surface-raised px-4 py-3 shadow-card focus-within:border-brand/50">
          <Icon name="search" size={20} className="text-ink-faint" />
          <input
            className="flex-1 bg-transparent text-base outline-none placeholder:text-ink-faint"
            placeholder="Search your vault…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim() && (!results || results.length === 0)) webSearch();
            }}
          />
          {query && (
            <button className="text-xs text-ink-faint hover:text-brand" onClick={webSearch} title="Search the web">
              Web ↗
            </button>
          )}
        </div>

        {/* search results */}
        {results !== null ? (
          <div className="mt-8">
            <SectionTitle>Results for “{query}”</SectionTitle>
            <BookmarkGrid items={results} view="grid" emptyHint="Nothing in your vault — press Enter to search the web." />
          </div>
        ) : (
          <>
            {/* favorites speed-dial */}
            {favorites.length > 0 && (
              <div className="mt-10">
                <SectionTitle>Favorites</SectionTitle>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-3">
                  {favorites.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => open(b)}
                      className="group flex flex-col items-center gap-2 rounded-xl border border-line bg-surface-raised p-3 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card"
                      title={b.title}
                    >
                      <Favicon src={b.favicon} size={28} />
                      <span className="line-clamp-2 text-center text-xs text-ink-soft">{b.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* collections */}
            {!minimal && c.collections.length > 0 && (
              <div className="mt-10">
                <SectionTitle>Collections</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {c.collections.map((col) => (
                    <a
                      key={col.id}
                      href={dashUrl(`#c=${col.id}`)}
                      className="flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 text-sm transition hover:border-brand/40 hover:shadow-card"
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color || 'currentColor' }} />
                      {col.icon ? `${col.icon} ` : ''}
                      {col.name}
                      <span className="text-xs text-ink-faint">{c.counts[col.id] ?? 0}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* recent */}
            {!minimal && recent.length > 0 && (
              <div className="mt-10">
                <SectionTitle>Recently saved</SectionTitle>
                <BookmarkGrid items={recent} view="grid" />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">{children}</h2>;
}
