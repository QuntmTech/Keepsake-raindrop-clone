import { useEffect, useMemo, useRef, useState } from 'react';
import {
  WIDGETS,
  type WidgetKey,
  notesStore,
  todosStore,
  type Todo,
  recentSaves,
  rediscoverSaves,
  pinToHome,
  getTopSites,
  getRecentlyClosed,
  restoreClosed,
  fetchWeather,
  weatherLook,
  type Weather,
  type TopSite,
  type ClosedTab,
} from '@/lib/widgets';
import { Favicon } from '@/components/Favicon';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { markVisited } from '@/lib/bookmarks';
import { faviconFor, safeDomain } from '@/lib/util';
import { type Bookmark } from '@/lib/types';

const genId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Widgets are below-the-fold garnish: their data loads AFTER the page has
// painted (idle callback, 1.5s cap) so they never compete with the launcher
// grid for the first frame.
function whenIdle(fn: () => void): () => void {
  const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, o?: { timeout: number }) => number);
  if (ric) {
    const id = ric(fn, { timeout: 1500 });
    return () => (window as any).cancelIdleCallback?.(id);
  }
  const id = setTimeout(fn, 250);
  return () => clearTimeout(id);
}

interface Ctx {
  panelCls: string;
  labelCls: string;
  onDark: boolean;
  enabled: WidgetKey[];
  pinnedUrls: Set<string>;
  onChanged: () => void;
}

// The dashboard: a "surface your stuff" strip zone on top, then a responsive
// card grid. Every widget self-hides when it has nothing to show, so the area
// silently collapses rather than showing empty boxes.
export function DashboardWidgets(ctx: Ctx) {
  const strip = ctx.enabled.filter((k) => WIDGETS.find((w) => w.key === k)?.zone === 'strip');
  const cards = ctx.enabled.filter((k) => WIDGETS.find((w) => w.key === k)?.zone === 'card');
  if (!ctx.enabled.length) return null;

  return (
    <div className="mx-auto mt-12 w-full max-w-5xl">
      <div className="flex flex-col gap-4">
        {strip.map((k) => (
          <WidgetSwitch key={k} k={k} {...ctx} />
        ))}
      </div>
      {cards.length > 0 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((k) => (
            <WidgetSwitch key={k} k={k} {...ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

function WidgetSwitch({ k, ...ctx }: Ctx & { k: WidgetKey }) {
  switch (k) {
    case 'jumpback':
      return <SavesStrip title="Jump back in" icon="inbox" fetcher={recentSaves} {...ctx} />;
    case 'rediscover':
      return <SavesStrip title="Rediscover" icon="sparkles" fetcher={rediscoverSaves} {...ctx} />;
    case 'notes':
      return <NotesWidget {...ctx} />;
    case 'todo':
      return <TodoWidget {...ctx} />;
    case 'topsites':
      return <TopSitesWidget {...ctx} />;
    case 'recentclosed':
      return <RecentClosedWidget {...ctx} />;
    case 'weather':
      return <WeatherWidget {...ctx} />;
    default:
      return null;
  }
}

// ── card shell ───────────────────────────────────────────────────────────────
function Card({ title, icon, panelCls, right, children }: { title: string; icon: any; panelCls: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`flex min-h-[9rem] flex-col rounded-2xl border p-4 ${panelCls}`}>
      <div className="mb-2.5 flex items-center gap-2">
        <Icon name={icon} size={15} className="text-ink-faint" />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <span className="ml-auto">{right}</span>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

// ── "surface my stuff" strips ────────────────────────────────────────────────
function SavesStrip({
  title,
  icon,
  fetcher,
  panelCls,
  labelCls,
  onDark,
}: Ctx & { title: string; icon: any; fetcher: (limit?: number) => Promise<Bookmark[]> }) {
  const [items, setItems] = useState<Bookmark[] | null>(null);
  useEffect(() => whenIdle(() => fetcher(8).then(setItems).catch(() => setItems([]))), [fetcher]);
  if (items && items.length === 0) return null; // nothing to show — collapse

  const open = (b: Bookmark) => {
    markVisited(b.id).catch(() => {});
    window.location.href = b.url;
  };
  return (
    <section className={`rounded-2xl border p-4 ${panelCls}`}>
      <div className="mb-3 flex items-center gap-2">
        <Icon name={icon} size={15} className="text-ink-faint" />
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(items ?? Array.from({ length: 5 })).map((b, i) =>
          b ? (
            <button
              key={b.id}
              onClick={() => open(b)}
              onAuxClick={(e) => e.button === 1 && (e.preventDefault(), window.open(b.url, '_blank', 'noopener'))}
              className="group flex w-40 shrink-0 flex-col gap-1.5 rounded-xl border border-line bg-surface p-2.5 text-left transition hover:-translate-y-0.5 hover:border-brand/50 hover:shadow-card"
              title={`${b.title}\n${b.url}`}
            >
              <span className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-raised">
                  <Favicon src={b.favicon} size={14} label={b.title} />
                </span>
                <span className="truncate text-xs font-medium text-ink">{b.title}</span>
              </span>
              <span className="truncate text-[11px] text-ink-faint">{b.domain || b.url}</span>
            </button>
          ) : (
            <div key={i} className="h-16 w-40 shrink-0 animate-pulse rounded-xl border border-line bg-surface" />
          ),
        )}
      </div>
    </section>
  );
}

// ── notes ────────────────────────────────────────────────────────────────────
function NotesWidget({ panelCls }: Ctx) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(true);
  const first = useRef(true);
  useEffect(() => {
    notesStore.getValue().then((v) => setText(v));
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved(false);
    const id = setTimeout(() => {
      notesStore.setValue(text).then(() => setSaved(true));
    }, 500);
    return () => clearTimeout(id);
  }, [text]);
  return (
    <Card title="Quick notes" icon="edit" panelCls={panelCls} right={<span className="text-[10px] text-ink-faint">{saved ? 'Saved' : '…'}</span>}>
      <textarea
        className="h-full min-h-[6rem] w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
        placeholder="Jot something down… it saves automatically."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Card>
  );
}

// ── to-do ────────────────────────────────────────────────────────────────────
function TodoWidget({ panelCls }: Ctx) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    todosStore.getValue().then(setTodos);
  }, []);
  const persist = (next: Todo[]) => {
    setTodos(next);
    todosStore.setValue(next).catch(() => {});
  };
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    persist([...todos, { id: genId(), text: t, done: false }]);
    setDraft('');
  };
  const toggle = (id: string) => persist(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const remove = (id: string) => persist(todos.filter((t) => t.id !== id));
  const doneCount = todos.filter((t) => t.done).length;

  return (
    <Card
      title="To-do"
      icon="check"
      panelCls={panelCls}
      right={
        doneCount > 0 ? (
          <button className="text-[10px] text-ink-faint hover:text-brand" onClick={() => persist(todos.filter((t) => !t.done))}>
            Clear done
          </button>
        ) : null
      }
    >
      <div className="flex h-full flex-col">
        <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2">
          <Icon name="plus" size={13} className="text-ink-faint" />
          <input
            className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-faint"
            placeholder="Add a task…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {todos.length === 0 && <li className="py-4 text-center text-xs text-ink-faint">Nothing yet — add your first task.</li>}
          {todos.map((t) => (
            <li key={t.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-sunken">
              <button
                onClick={() => toggle(t.id)}
                className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${t.done ? 'border-brand bg-brand text-white' : 'border-line'}`}
              >
                {t.done && <Icon name="check" size={11} />}
              </button>
              <span className={`flex-1 truncate text-sm ${t.done ? 'text-ink-faint line-through' : 'text-ink'}`}>{t.text}</span>
              <button className="opacity-0 transition group-hover:opacity-100" onClick={() => remove(t.id)} title="Delete">
                <Icon name="close" size={13} className="text-ink-faint hover:text-red-500" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ── most visited (top sites) ─────────────────────────────────────────────────
function TopSitesWidget({ panelCls, pinnedUrls, onChanged }: Ctx) {
  const [sites, setSites] = useState<TopSite[] | null>(null);
  const { toast } = useToast();
  useEffect(() => whenIdle(() => getTopSites(8).then(setSites).catch(() => setSites([]))), []);
  if (sites && sites.length === 0) return null;
  const norm = (u: string) => u.replace(/\/+$/, '');
  const pin = async (s: TopSite) => {
    try {
      await pinToHome(s.url, s.title);
      toast(`Pinned ${s.title} to Home`, 'success');
      onChanged();
    } catch {
      toast('Could not pin that site', 'error');
    }
  };
  return (
    <Card title="Most visited" icon="grid" panelCls={panelCls}>
      <ul className="space-y-0.5">
        {(sites ?? []).map((s) => {
          const pinned = pinnedUrls.has(norm(s.url));
          return (
            <li key={s.url} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-sunken">
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-raised">
                <Favicon src={faviconFor(safeDomain(s.url))} size={14} label={s.title} />
              </span>
              <a href={s.url} className="flex-1 truncate text-sm text-ink hover:text-brand" title={s.url}>
                {s.title}
              </a>
              <button
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] transition ${
                  pinned ? 'text-ink-faint' : 'text-brand opacity-0 hover:bg-brand/10 group-hover:opacity-100'
                }`}
                disabled={pinned}
                onClick={() => pin(s)}
                title={pinned ? 'Already on Home' : 'Pin to Home'}
              >
                {pinned ? '✓ pinned' : '+ pin'}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ── recently closed ──────────────────────────────────────────────────────────
function RecentClosedWidget({ panelCls }: Ctx) {
  const [tabs, setTabs] = useState<ClosedTab[] | null>(null);
  useEffect(() => whenIdle(() => getRecentlyClosed(7).then(setTabs).catch(() => setTabs([]))), []);
  if (tabs && tabs.length === 0) return null;
  return (
    <Card title="Recently closed" icon="import" panelCls={panelCls}>
      <ul className="space-y-0.5">
        {(tabs ?? []).map((t, i) => (
          <li key={`${t.url}-${i}`}>
            <button
              onClick={() => (t.sessionId ? restoreClosed(t.sessionId) : window.open(t.url, '_blank'))}
              className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-surface-sunken"
              title={`Reopen ${t.url}`}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-raised">
                <Favicon src={faviconFor(safeDomain(t.url))} size={14} label={t.title} />
              </span>
              <span className="flex-1 truncate text-sm text-ink">{t.title}</span>
              <Icon name="external" size={12} className="shrink-0 text-ink-faint" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── weather ──────────────────────────────────────────────────────────────────
function WeatherWidget({ panelCls }: Ctx) {
  const [w, setW] = useState<Weather | null | 'loading'>('loading');
  useEffect(() => whenIdle(() => fetchWeather().then((r) => setW(r)).catch(() => setW(null))), []);
  if (w === null) return null; // no permission / offline — hide
  const look = w && w !== 'loading' ? weatherLook(w.code) : null;
  return (
    <Card title="Weather" icon="image" panelCls={panelCls}>
      {w === 'loading' ? (
        <p className="py-4 text-center text-xs text-ink-faint">Loading…</p>
      ) : (
        <div className="flex items-center gap-3 py-1">
          <span className="text-4xl">{look?.icon}</span>
          <div>
            <p className="text-2xl font-semibold text-ink">
              {w.tempF}°<span className="text-sm text-ink-faint">F · {w.tempC}°C</span>
            </p>
            <p className="text-xs text-ink-soft">
              {look?.label}
              {w.place ? ` · ${w.place}` : ''}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
