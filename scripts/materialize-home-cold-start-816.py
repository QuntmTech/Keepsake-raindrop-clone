from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


# Lightweight URL identity helper. The catalog data must never ride in the
# initial new-tab bundle merely because Home needs URL normalization.
Path('lib/appUrl.ts').write_text("""// Small URL helper shared by Home and the optional app catalog.
// Keep this module data-free so importing it never pulls suggested-apps.json
// into the new-tab startup bundle.
export function normUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\\./, '').toLowerCase() + u.pathname.replace(/\\/+$/, '');
  } catch {
    return url.toLowerCase();
  }
}
""")

apps_path = Path('lib/apps.ts')
apps = apps_path.read_text()
apps = replace_once(
    apps,
    "import seed from './suggested-apps.json';\n",
    "import seed from './suggested-apps.json';\nexport { normUrl } from './appUrl';\n",
    'apps re-export',
)
apps = replace_once(
    apps,
    """// Normalize a URL for \"already added\" checks (host minus www + path minus slash).
export function normUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\\./, '').toLowerCase() + u.pathname.replace(/\\/+$/, '');
  } catch {
    return url.toLowerCase();
  }
}
""",
    '',
    'remove catalog-coupled normUrl',
)
apps_path.write_text(apps)

catalog_path = Path('components/AppCatalog.tsx')
catalog = catalog_path.read_text()
catalog = replace_once(
    catalog,
    "import { APP_CATEGORIES, categoryColor, normUrl, type CatalogApp, type CatalogCategory } from '@/lib/apps';",
    "import { APP_CATEGORIES, categoryColor, type CatalogApp, type CatalogCategory } from '@/lib/apps';\nimport { normUrl } from '@/lib/appUrl';",
    'AppCatalog normUrl import',
)
catalog_path.write_text(catalog)

widgets_path = Path('components/home/DashboardWidgets.tsx')
widgets = widgets_path.read_text()
widgets = replace_once(
    widgets,
    "import { normUrl } from '@/lib/apps';",
    "import { normUrl } from '@/lib/appUrl';",
    'DashboardWidgets normUrl import',
)
widgets_path.write_text(widgets)

# Auth now exposes the cached user id. Home and collections use that same id,
# avoiding duplicate auth reads/backend construction during cold start.
auth_path = Path('hooks/useAuth.ts')
auth = auth_path.read_text()
auth = replace_once(
    auth,
    "  const [authed, setAuthed] = useState(false);\n  const [email, setEmail] = useState<string | null>(null);",
    "  const [authed, setAuthed] = useState(false);\n  const [id, setId] = useState<string | null>(null);\n  const [email, setEmail] = useState<string | null>(null);",
    'useAuth id state',
)
auth = replace_once(
    auth,
    "        setAuthed(true);\n        setEmail(cached.email);",
    "        setAuthed(true);\n        setId(cached.id);\n        setEmail(cached.email);",
    'useAuth cached id',
)
auth = replace_once(
    auth,
    "        setAuthed(verified.loggedIn);\n        setEmail(verified.user?.email ?? null);",
    "        setAuthed(verified.loggedIn);\n        setId(verified.user?.id ?? null);\n        setEmail(verified.user?.email ?? null);",
    'useAuth verified id',
)
auth = replace_once(
    auth,
    "      setAuthed(Boolean(cached));\n      setEmail(cached?.email ?? null);",
    "      setAuthed(Boolean(cached));\n      setId(cached?.id ?? null);\n      setEmail(cached?.email ?? null);",
    'useAuth watched id',
)
auth = replace_once(
    auth,
    "    setAuthed(true);\n    setEmail(user.email);",
    "    setAuthed(true);\n    setId(user.id);\n    setEmail(user.email);",
    'useAuth login id',
)
auth = replace_once(
    auth,
    "    setAuthed(true);\n    setEmail(user.email);",
    "    setAuthed(true);\n    setId(user.id);\n    setEmail(user.email);",
    'useAuth signup id',
)
auth = replace_once(
    auth,
    "    setAuthed(false);\n    setEmail(null);",
    "    setAuthed(false);\n    setId(null);\n    setEmail(null);",
    'useAuth logout id',
)
auth = replace_once(
    auth,
    "  return { ready, authed, email, plan, login, signup, logout };",
    "  return { ready, authed, id, email, plan, login, signup, logout };",
    'useAuth return id',
)
auth_path.write_text(auth)

# Also preserve Max in the fast auth mirror; otherwise a Max user is briefly
# downgraded to Free during the very paint path we are optimizing.
auth_facade_path = Path('lib/auth.ts')
auth_facade = auth_facade_path.read_text()
auth_facade = replace_once(
    auth_facade,
    "const plan = parsed.record.plan === 'owner' || parsed.record.plan === 'pro' ? parsed.record.plan : 'free';",
    "const plan =\n      parsed.record.plan === 'owner' || parsed.record.plan === 'pro' || parsed.record.plan === 'max'\n        ? parsed.record.plan\n        : 'free';",
    'cached Max plan',
)
auth_facade_path.write_text(auth_facade)

# Deduplicate simultaneous snapshot reads from Home + collections.
cache_path = Path('lib/cache.ts')
cache = cache_path.read_text()
cache = replace_once(
    cache,
    "const item = storage.defineItem<VaultSnapshot | null>('local:vault_snapshot', { fallback: null });\n",
    "const item = storage.defineItem<VaultSnapshot | null>('local:vault_snapshot', { fallback: null });\nlet inFlightRead: Promise<VaultSnapshot | null> | null = null;\n",
    'snapshot in-flight cache',
)
cache = replace_once(
    cache,
    """export async function readLastSnapshot(): Promise<VaultSnapshot | null> {
  if (!HOSTED) return null;
  return item.getValue();
}
""",
    """export async function readLastSnapshot(): Promise<VaultSnapshot | null> {
  if (!HOSTED) return null;
  if (!inFlightRead) {
    inFlightRead = item.getValue().finally(() => {
      inFlightRead = null;
    });
  }
  return inFlightRead;
}
""",
    'dedupe snapshot reads',
)
cache_path.write_text(cache)

# Home uses cached collections immediately, fetches collection rows without
# waiting for counts, then refreshes counts after the launcher has painted.
collections_path = Path('hooks/useCollections.ts')
collections = collections_path.read_text()
collections = replace_once(collections, "import { readCachedAuthUser } from '@/lib/auth';\n", '', 'remove duplicate auth read')
collections = replace_once(
    collections,
    "export function useCollections(authed: boolean) {",
    """interface UseCollectionsOptions {
  userId?: string | null;
  deferCounts?: boolean;
}

export function useCollections(authed: boolean, options: UseCollectionsOptions = {}) {
  const userId = options.userId ?? null;
  const deferCounts = Boolean(options.deferCounts);""",
    'useCollections options',
)
old_effect = """  // Both reads use chrome.storage only. This keeps startup fast while still
  // preventing a previous account's snapshot from flashing after an account switch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cachedUser = await readCachedAuthUser();
      const snapshot = await readSnapshot(cachedUser?.id ?? null);
      if (!cancelled && snapshot) {
        setCollections(snapshot.collections);
        setCounts(snapshot.counts);
        setLoading(false);
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);
"""
new_effect = """  // Home already has the cached auth id, so it can read its snapshot without a
  // second auth-storage round trip. When deferCounts is enabled, collection rows
  // refresh first and the heavier aggregate counts wait until after first paint.
  useEffect(() => {
    let cancelled = false;
    let rowsTimer: ReturnType<typeof setTimeout> | null = null;
    let countsTimer: ReturnType<typeof setTimeout> | null = null;

    const loadRowsThenCounts = async () => {
      try {
        const nextCollections = await listCollections();
        if (!cancelled) setCollections(nextCollections);
      } catch {
        // Cached folders stay visible while offline or during a slow server start.
      } finally {
        if (!cancelled) setLoading(false);
      }
      countsTimer = setTimeout(() => {
        countByCollection()
          .then((nextCounts) => {
            if (!cancelled) setCounts(nextCounts);
          })
          .catch(() => {});
      }, 650);
    };

    (async () => {
      const snapshot = await readSnapshot(userId);
      if (!cancelled && snapshot) {
        setCollections(snapshot.collections);
        setCounts(snapshot.counts);
        setLoading(false);
      }
      if (!authed || cancelled) {
        if (!authed) setLoading(false);
        return;
      }
      if (!deferCounts) {
        await refresh();
        return;
      }
      if (snapshot) rowsTimer = setTimeout(loadRowsThenCounts, 180);
      else await loadRowsThenCounts();
    })();

    return () => {
      cancelled = true;
      if (rowsTimer) clearTimeout(rowsTimer);
      if (countsTimer) clearTimeout(countsTimer);
    };
  }, [authed, deferCounts, refresh, userId]);
"""
collections = replace_once(collections, old_effect, new_effect, 'deferred Home collections')
collections_path.write_text(collections)

# New-tab bundle: lazy-load click-only dialogs/catalog and below-fold widgets.
app_path = Path('entrypoints/newtab/App.tsx')
app = app_path.read_text()
app = replace_once(
    app,
    "import { useCallback, useEffect, useMemo, useRef, useState } from 'react';",
    "import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';",
    'React lazy imports',
)
app = app.replace("import { currentUser } from '@/lib/auth';\n", '')
for line in [
    "import { AddDialog } from '@/components/AddDialog';\n",
    "import { AppCatalog } from '@/components/AppCatalog';\n",
    "import { WatchingStrip } from '@/components/WatchingStrip';\n",
    "import { DashboardWidgets } from '@/components/home/DashboardWidgets';\n",
    "import { EditDialog } from '@/components/EditDialog';\n",
]:
    if app.count(line) != 1:
        raise SystemExit(f'missing lazy import line: {line.strip()}')
    app = app.replace(line, '')
app = replace_once(app, "import { normUrl } from '@/lib/apps';", "import { normUrl } from '@/lib/appUrl';", 'Home lightweight normUrl')
app = replace_once(app, "import { Tour, type TourStep } from '@/components/Tour';", "import { type TourStep } from '@/components/Tour';", 'Tour type-only import')

lazy_defs = """
const AddDialog = lazy(() => import('@/components/AddDialog').then((m) => ({ default: m.AddDialog })));
const AppCatalog = lazy(() => import('@/components/AppCatalog').then((m) => ({ default: m.AppCatalog })));
const EditDialog = lazy(() => import('@/components/EditDialog').then((m) => ({ default: m.EditDialog })));
const Tour = lazy(() => import('@/components/Tour').then((m) => ({ default: m.Tour })));
const DashboardWidgets = lazy(() =>
  import('@/components/home/DashboardWidgets').then((m) => ({ default: m.DashboardWidgets })),
);
const WatchingStrip = lazy(() => import('@/components/WatchingStrip').then((m) => ({ default: m.WatchingStrip })));
"""
app = replace_once(
    app,
    "const layoutStore = storage.defineItem<string[]>('local:home_layout', { fallback: [] });\n",
    "const layoutStore = storage.defineItem<string[]>('local:home_layout', { fallback: [] });\n" + lazy_defs,
    'lazy component definitions',
)
app = replace_once(
    app,
    "  const { ready, authed, email, login, signup } = useAuth();\n  const { settings, update } = useSettings();\n  const c = useCollections(authed);",
    "  const { ready, authed, id: userId, email, login, signup } = useAuth();\n  const { settings, update } = useSettings();\n  const c = useCollections(authed, { userId, deferCounts: true });",
    'Home auth and collection fast path',
)
app = replace_once(
    app,
    "  const [catalogOpen, setCatalogOpen] = useState(false);\n  const [allTags, setAllTags] = useState<string[]>([]);",
    "  const [catalogOpen, setCatalogOpen] = useState(false);\n  const [extrasReady, setExtrasReady] = useState(false);\n  const [allTags, setAllTags] = useState<string[]>([]);",
    'extras ready state',
)
old_snapshot = """  // Paint cached links instantly on open, then refresh.
  useEffect(() => {
    (async () => {
      uidRef.current = (await currentUser())?.id ?? null;
      const snap = await readSnapshot(uidRef.current);
      if (snap && snap.bookmarks.length) setAll((cur) => (cur.length ? cur : snap.bookmarks));
    })();
  }, []);
"""
new_snapshot = """  // Paint cached links immediately using the id already resolved by useAuth.
  // This avoids reading auth twice and avoids accidentally constructing PocketBase
  // solely to discover the same user id during a cold browser start.
  useEffect(() => {
    uidRef.current = userId;
    if (!userId) return;
    readSnapshot(userId).then((snap) => {
      if (snap?.bookmarks.length) setAll((cur) => (cur.length ? cur : snap.bookmarks));
    });
  }, [userId]);
"""
app = replace_once(app, old_snapshot, new_snapshot, 'Home snapshot fast path')

extras_effect = """
  // The launcher shell is the product's first impression. Mount below-the-fold
  // widgets and their ResizeObservers only after the first frame/idle slot.
  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(() => setExtrasReady(true), { timeout: 650 });
      return () => win.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setExtrasReady(true), 120);
    return () => window.clearTimeout(id);
  }, []);
"""
app = replace_once(
    app,
    "  useEffect(() => {\n    const id = setInterval(() => setNow(new Date()), 30_000);",
    extras_effect + "\n  useEffect(() => {\n    const id = setInterval(() => setNow(new Date()), 30_000);",
    'defer secondary Home UI',
)

old_widgets = """        {results === null && !minimal && (
          <DashboardWidgets
            panelCls={panelCls}
            labelCls={labelCls}
            onDark={onDark}
            enabled={settings.homeWidgets as WidgetKey[]}
            cardStyle={settings.widgetColor ? { background: settings.widgetColor } : undefined}
            pinnedUrls={new Set(pinnedItems.map((b) => normUrl(b.url)))}
            onChanged={() => {
              reloadAll();
              c.refresh();
            }}
          />
        )}
        {results === null && !minimal && <WatchingStrip panelCls={panelCls} labelCls={labelCls} />}
"""
new_widgets = """        {extrasReady && results === null && !minimal && (
          <Suspense fallback={null}>
            <DashboardWidgets
              panelCls={panelCls}
              labelCls={labelCls}
              onDark={onDark}
              enabled={settings.homeWidgets as WidgetKey[]}
              cardStyle={settings.widgetColor ? { background: settings.widgetColor } : undefined}
              pinnedUrls={new Set(pinnedItems.map((b) => normUrl(b.url)))}
              onChanged={() => {
                reloadAll();
                c.refresh();
              }}
            />
          </Suspense>
        )}
        {extrasReady && results === null && !minimal && (
          <Suspense fallback={null}>
            <WatchingStrip panelCls={panelCls} labelCls={labelCls} />
          </Suspense>
        )}
"""
app = replace_once(app, old_widgets, new_widgets, 'lazy below-fold widgets')

app = replace_once(
    app,
    """      {addTo && (
        <AddDialog
          collections={c.collections}
          allTags={allTags}
          defaultCollection={addTo.collection}
          pinned
          homeContext
          onClose={() => setAddTo(null)}
          onAdded={() => {
            reloadAll();
            c.refresh();
          }}
        />
      )}
""",
    """      {addTo && (
        <Suspense fallback={null}>
          <AddDialog
            collections={c.collections}
            allTags={allTags}
            defaultCollection={addTo.collection}
            pinned
            homeContext
            onClose={() => setAddTo(null)}
            onAdded={() => {
              reloadAll();
              c.refresh();
            }}
          />
        </Suspense>
      )}
""",
    'lazy AddDialog render',
)
app = replace_once(
    app,
    """      {editing && (
        <EditDialog
          bookmark={editing}
          collections={c.collections}
          allTags={allTags}
          onClose={() => setEditing(null)}
          onSaved={() => {
            reloadAll();
            c.refresh();
          }}
        />
      )}
""",
    """      {editing && (
        <Suspense fallback={null}>
          <EditDialog
            bookmark={editing}
            collections={c.collections}
            allTags={allTags}
            onClose={() => setEditing(null)}
            onSaved={() => {
              reloadAll();
              c.refresh();
            }}
          />
        </Suspense>
      )}
""",
    'lazy EditDialog render',
)
app = replace_once(
    app,
    """      {catalogOpen && (
        <AppCatalog
          pinnedUrls={new Set(pinnedItems.map((b) => normUrl(b.url)))}
          onClose={() => setCatalogOpen(false)}
          onCustom={() => {
            setCatalogOpen(false);
            setAddTo({});
          }}
          onChanged={() => {
            reloadAll();
            c.refresh();
          }}
        />
      )}
""",
    """      {catalogOpen && (
        <Suspense fallback={null}>
          <AppCatalog
            pinnedUrls={new Set(pinnedItems.map((b) => normUrl(b.url)))}
            onClose={() => setCatalogOpen(false)}
            onCustom={() => {
              setCatalogOpen(false);
              setAddTo({});
            }}
            onChanged={() => {
              reloadAll();
              c.refresh();
            }}
          />
        </Suspense>
      )}
""",
    'lazy AppCatalog render',
)
app = replace_once(
    app,
    "      {tour && <Tour steps={HOME_TOUR} onDone={finishTour} />}",
    "      {tour && (\n        <Suspense fallback={null}>\n          <Tour steps={HOME_TOUR} onDone={finishTour} />\n        </Suspense>\n      )}",
    'lazy Tour render',
)
app_path.write_text(app)

# Focused source regression + post-build bundle assertion.
Path('scripts/test-home-cold-start-816.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../entrypoints/newtab/App.tsx', import.meta.url), 'utf8');
const apps = readFileSync(new URL('../lib/apps.ts', import.meta.url), 'utf8');
const appUrl = readFileSync(new URL('../lib/appUrl.ts', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../hooks/useAuth.ts', import.meta.url), 'utf8');
const collections = readFileSync(new URL('../hooks/useCollections.ts', import.meta.url), 'utf8');

test('Home does not import the app catalog to normalize URLs', () => {
  assert.match(app, /normUrl.*@\/lib\/appUrl/);
  assert.doesNotMatch(app, /normUrl.*@\/lib\/apps/);
  assert.match(appUrl, /export function normUrl/);
  assert.match(apps, /suggested-apps\.json/);
});

test('click-only and below-fold Home surfaces are lazy', () => {
  for (const name of ['AppCatalog', 'AddDialog', 'EditDialog', 'Tour', 'DashboardWidgets', 'WatchingStrip']) {
    assert.match(app, new RegExp(`const ${name} = lazy\\(`));
  }
  assert.match(app, /requestIdleCallback/);
  assert.match(app, /extrasReady && results === null/);
  assert.match(app, /<Suspense fallback=\{null\}>/);
});

test('cached user id is reused instead of constructing the backend again', () => {
  assert.match(auth, /return \{ ready, authed, id, email/);
  assert.match(app, /id: userId/);
  assert.match(app, /readSnapshot\(userId\)/);
  assert.doesNotMatch(app, /currentUser\(\)/);
  assert.match(collections, /deferCounts/);
  assert.match(collections, /countByCollection\(\)[\s\S]*650/);
});
""")

Path('scripts/check-home-startup-bundle.mjs').write_text("""import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = '.output/chrome-mv3';
const html = readFileSync(join(root, 'newtab.html'), 'utf8');
const src = html.match(/<script[^>]+src=\"([^\"]*newtab-[^\"]+\.js)\"/)?.[1];
assert.ok(src, 'newtab entry chunk not found');
const entryPath = join(root, src.replace(/^\//, ''));
const entry = readFileSync(entryPath, 'utf8');
const entryBytes = statSync(entryPath).size;
assert.ok(entryBytes < 65000, `newtab entry is still too large: ${entryBytes} bytes`);
assert.ok(!entry.includes('Palmetto State Armory'), 'app catalog leaked into the startup chunk');
assert.ok(!html.includes('AppCatalog-'), 'app catalog is still module-preloaded on startup');
const chunks = readdirSync(join(root, 'chunks'));
const catalogChunk = chunks.find((name) => name.startsWith('AppCatalog-'));
assert.ok(catalogChunk, 'lazy AppCatalog chunk missing');
const catalog = readFileSync(join(root, 'chunks', catalogChunk), 'utf8');
assert.ok(catalog.includes('Palmetto State Armory'), 'catalog data did not move into the lazy chunk');
console.log(`Verified cold-start bundle: ${entryBytes} byte newtab entry; catalog lazy in ${catalogChunk}`);
""")

package_path = Path('package.json')
package = json.loads(package_path.read_text())
package['scripts']['test:home-cold-start-816'] = 'node --test scripts/test-home-cold-start-816.mjs'
package['scripts']['check:home-startup-bundle'] = 'node scripts/check-home-startup-bundle.mjs'
if 'npm run test:home-cold-start-816' not in package['scripts']['test']:
    package['scripts']['test'] += ' && npm run test:home-cold-start-816'
package_path.write_text(json.dumps(package, indent=2) + '\n')

print('Home cold-start performance changes materialized.')
