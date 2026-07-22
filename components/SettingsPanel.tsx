import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useCollections } from '@/hooks/useCollections';
import { LoginForm } from './LoginForm';
import { PlanBadge } from './PlanBadge';
import { AdminBilling } from './AdminBilling';
import { Icon } from './Icon';
import { AiEngineSettings } from './AiEngineSettings';
import { useToast } from './Toast';
import { ACCENTS } from '@/lib/theme';
import { type Accent, type AiSettings, type LlmProvider, type SortMode, type ThemeMode, type UiSurface, type ViewMode } from '@/lib/types';
import { getAiSettings, setAiSettings } from '@/lib/ai';
import { PROVIDER_DEFAULTS, testProviderKey } from '@/lib/llm';
import { getBackendMode, setBackendMode, HOSTED, type BackendMode } from '@/lib/backend';
import { getPbUrl, setPbUrl } from '@/lib/backend/pocketbase';
import { clearLocalData } from '@/lib/backend/local';
import { detectAndParse, importWithAi, exportJson } from '@/lib/importer';
import { searchBookmarks, deleteBookmark } from '@/lib/bookmarks';
import { send } from '@/lib/messaging';

// All of Keepsake's settings in one component, used by the full-page options
// screen AND inside the popup / side panel (compact mode) — so you never have
// to leave the dropdown to change something.
export function SettingsPanel({ compact = false }: { compact?: boolean }) {
  const { ready, authed, email, plan, login, signup, logout } = useAuth();
  const { settings, update } = useSettings();
  const collectionsApi = useCollections(authed);
  const { toast } = useToast();

  const [ai, setAi] = useState<AiSettings | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [backend, setBackend] = useState<BackendMode>('local');
  const [pbUrl, setPbUrlDraft] = useState('');
  const [pbBusy, setPbBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [deduping, setDeduping] = useState(false);
  const [billingBusy, setBillingBusy] = useState<'month' | 'year' | 'portal' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAiSettings().then((s) => {
      setAi(s);
      setKeyDraft(s.apiKey);
    });
    getBackendMode().then(setBackend);
    getPbUrl().then(setPbUrlDraft);
  }, []);

  const patchAi = async (p: Partial<AiSettings>) => setAi(await setAiSettings(p));

  const commitKey = () => {
    if (ai && keyDraft !== ai.apiKey) patchAi({ apiKey: keyDraft.trim() });
  };

  async function runTest() {
    if (!keyDraft.trim() || !ai) return;
    commitKey();
    setTesting(true);
    try {
      const ok = await testProviderKey(ai.provider ?? 'anthropic', keyDraft.trim());
      toast(ok ? 'API key works!' : 'Key rejected — check it', ok ? 'success' : 'error');
    } catch {
      toast('Could not reach the API', 'error');
    } finally {
      setTesting(false);
    }
  }

  // Local can be switched instantly. PocketBase needs a URL first, so selecting
  // it only reveals the form; "Connect" persists the URL + mode and reloads.
  async function pickLocal() {
    setBackend('local');
    await setBackendMode('local');
    toast('Switched to on-device storage — reloading…', 'info');
    setTimeout(() => location.reload(), 700);
  }

  async function connectPocketBase() {
    const url = pbUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) {
      toast('Enter a full URL starting with https://', 'error');
      return;
    }
    setPbBusy(true);
    try {
      // Quick reachability check against PocketBase's health endpoint.
      const res = await fetch(`${url}/api/health`).catch(() => null);
      if (!res || !res.ok) {
        toast('Could not reach that PocketBase URL — check it', 'error');
        setPbBusy(false);
        return;
      }
      await setPbUrl(url);
      await setBackendMode('pocketbase');
      toast('Connected to PocketBase — reloading…', 'success');
      setTimeout(() => location.reload(), 700);
    } catch {
      toast('Could not connect', 'error');
      setPbBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const { format, items } = detectAndParse(file.name, text);
    if (items.length === 0) {
      toast('No bookmarks found in that file', 'error');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setImporting(`0 / ${items.length}`);
    const res = await importWithAi(items, settings.defaultCollection, (p) =>
      setImporting(`${p.done} / ${p.total}`),
    );
    setImporting(null);
    const label = format === 'raindrop-csv' ? 'from Raindrop' : format === 'pocket-csv' ? 'from Pocket' : '';
    toast(
      `Imported ${res.done - res.failed} ${label} · ${res.duplicates} duplicate${res.duplicates === 1 ? '' : 's'} skipped` +
        (res.queuedForAi ? ` · ${res.queuedForAi} queued for AI filing` : ''),
      'success',
    );
    collectionsApi.refresh();
    if (fileRef.current) fileRef.current.value = '';
  }

  async function doExport() {
    // homeTiles:'include' — a backup must contain the Home launcher tiles too.
    const all = await searchBookmarks('', { perPage: 9999, homeTiles: 'include' });
    if (all.length === 0) {
      toast('Nothing to export yet', 'info');
      return;
    }
    const blob = exportJson(all);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keepsake-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${all.length} bookmarks`, 'success');
  }

  async function findDuplicates() {
    setDeduping(true);
    try {
      const all = await searchBookmarks('', { perPage: 9999 }); // newest-first
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const b of all) {
        const key = b.url.replace(/\/+$/, '').toLowerCase();
        if (seen.has(key)) dupes.push(b.id);
        else seen.add(key);
      }
      if (!dupes.length) {
        toast('No duplicate links found', 'info');
        return;
      }
      if (!confirm(`Remove ${dupes.length} duplicate bookmark(s)? The most recent copy of each link is kept.`)) return;
      let removed = 0;
      for (const id of dupes) {
        try {
          await deleteBookmark(id);
          removed++;
        } catch {
          /* ignore */
        }
      }
      toast(`Removed ${removed} duplicate${removed === 1 ? '' : 's'}`, 'success');
    } finally {
      setDeduping(false);
    }
  }

  async function wipeLocal() {
    if (!confirm('Delete ALL locally-saved bookmarks, folders, and highlights? Your account stays. This cannot be undone.')) return;
    await clearLocalData();
    toast('Local data cleared', 'success');
    setTimeout(() => location.reload(), 600);
  }

  // The background owns the actual Checkout/Portal tab (see entrypoints/
  // background.ts) so it survives this popup closing — Chrome unloads a
  // popup the instant it loses focus, which window.open() from here would
  // trigger immediately. This only relays the click.
  async function upgrade(interval: 'month' | 'year') {
    setBillingBusy(interval);
    try {
      const r = await send<{ ok: boolean; error?: string }>({ type: 'KS_START_CHECKOUT', interval });
      if (!r?.ok) throw new Error(r?.error || 'Could not start checkout');
      toast('Opening checkout…', 'info');
    } catch (e) {
      toast((e as Error)?.message || 'Could not start checkout', 'error');
    } finally {
      setBillingBusy(null);
    }
  }

  async function manageBilling() {
    setBillingBusy('portal');
    try {
      const r = await send<{ ok: boolean; error?: string }>({ type: 'KS_OPEN_BILLING_PORTAL' });
      if (!r?.ok) throw new Error(r?.error || 'Could not open the billing portal');
    } catch (e) {
      toast((e as Error)?.message || 'Could not open the billing portal', 'error');
    } finally {
      setBillingBusy(null);
    }
  }

  if (!ready) return <div className="p-8 text-center text-sm text-ink-faint">Loading…</div>;

  return (
    <div className={compact ? 'p-3' : 'mx-auto max-w-2xl px-6 py-10'}>
      {!compact && (
        <h1 className="mb-6 flex items-center gap-2 text-xl font-semibold text-ink">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white">
            <Icon name="settings" size={18} />
          </span>
          Keepsake Settings
        </h1>
      )}

      <Section title="Account" compact={compact}>
        {authed ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm text-ink-soft">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/10 font-semibold uppercase text-brand">
                  {email?.[0] ?? '?'}
                </span>
                <span className="truncate">{email}</span>
                <PlanBadge plan={plan} />
              </div>
              <button className="btn-outline shrink-0" onClick={logout}>
                <Icon name="logout" size={15} /> Sign out
              </button>
            </div>

            {HOSTED && plan === 'free' && (
              <div className="rounded-lg border border-line bg-surface-sunken p-3">
                <p className="text-sm font-medium text-ink">Upgrade to Pro</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Unlimited cloud bookmarks, full Capture Studio, 25 active watches, and 10 GB storage.
                </p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-outline flex-1" onClick={() => upgrade('month')} disabled={billingBusy !== null}>
                    {billingBusy === 'month' ? 'Opening…' : '$6.99/mo'}
                  </button>
                  <button className="btn-primary flex-1" onClick={() => upgrade('year')} disabled={billingBusy !== null}>
                    {billingBusy === 'year' ? 'Opening…' : '$49/yr — 7-day free trial'}
                  </button>
                </div>
              </div>
            )}

            {HOSTED && plan === 'pro' && (
              <button className="btn-outline" onClick={manageBilling} disabled={billingBusy !== null}>
                {billingBusy === 'portal' ? 'Opening…' : 'Manage billing'}
              </button>
            )}
          </div>
        ) : (
          <LoginForm onLogin={login} onSignup={signup} compact />
        )}
      </Section>

      {/* Owner-only billing admin. HOSTED-gated too, so local-mode accounts —
          which are ALL 'owner' — never see it; only the real cloud owner does. */}
      {HOSTED && authed && plan === 'owner' && <AdminBilling />}

      {HOSTED ? (
        <Section title="Sync" compact={compact}>
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-500/15 text-emerald-500">
              <Icon name="check" size={13} />
            </span>
            Your bookmarks sync securely to your account.
          </div>
        </Section>
      ) : (
      <Section title="Storage" compact={compact} hint="Where your bookmarks live. Local works instantly with no server; PocketBase syncs across devices and survives reinstalls.">
        <div className="flex flex-col gap-2">
          <Radio checked={backend === 'local'} onChange={pickLocal} label="On this device (local storage)" sub="Fully functional, no setup. Data stays in your browser profile." />
          <Radio checked={backend === 'pocketbase'} onChange={() => setBackend('pocketbase')} label="PocketBase server (cloud sync)" sub="Real accounts that sync across devices and survive reinstalls." />
        </div>

        {backend === 'pocketbase' && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken p-3">
            <label className="text-xs font-medium text-ink-soft">Your PocketBase server URL</label>
            <input
              className="input font-mono text-xs"
              placeholder="https://your-app.pockethost.io"
              value={pbUrl}
              onChange={(e) => setPbUrlDraft(e.target.value)}
            />
            <button className="btn-primary" onClick={connectPocketBase} disabled={pbBusy}>
              {pbBusy ? 'Connecting…' : 'Connect & switch'}
            </button>
            <p className="text-xs text-ink-faint">
              No server yet? Create a free one at <b>pockethost.io</b>, then import the schema file
              from the setup guide. After connecting, create your account here again (cloud accounts
              are separate from local ones).
            </p>
          </div>
        )}
      </Section>
      )}

      <Section title="When I click the toolbar icon" compact={compact}>
        <div className="flex flex-col gap-2">
          {(['popup', 'sidepanel', 'dashboard'] as UiSurface[]).map((s) => (
            <Radio
              key={s}
              checked={settings.primarySurface === s}
              onChange={() => update({ primarySurface: s })}
              label={s === 'popup' ? 'Open the quick-save popup' : s === 'sidepanel' ? 'Open the side panel' : 'Open the full dashboard'}
            />
          ))}
        </div>
      </Section>

      <AiEngineSettings compact={compact} />

      <Section
        title="Ambient Recall"
        compact={compact}
        hint="Surfaces 'you saved things about this' while you browse. All matching runs on your device against your own library — no page content ever leaves it, and no network calls are made."
      >
        <Toggle
          label="Show related saves while browsing (toolbar badge, Quick Bar + side panel)"
          checked={settings.recallEnabled}
          onChange={(v) => update({ recallEnabled: v })}
        />
        {settings.recallEnabled && (
          <>
            <label className="mt-2 block text-xs font-medium text-ink-soft">
              Never match on these sites (one domain per line — banking etc.)
            </label>
            <textarea
              className="input mt-1 h-20 font-mono text-xs"
              placeholder={'mybank.com\nhealthportal.com'}
              defaultValue={settings.recallBlocklist.join('\n')}
              onBlur={(e) =>
                update({
                  recallBlocklist: e.target.value
                    .split('\n')
                    .map((d) => d.trim())
                    .filter(Boolean),
                })
              }
            />
          </>
        )}
      </Section>

      <Section title="Capture" compact={compact} hint="The Quick Bar is a draggable widget on the edge of every page. Use its gear to reorder buttons, change size/color, or add a custom shortcut. Ctrl+Shift+K opens the folder picker.">
        <Toggle label="Show the in-page Quick Bar" checked={settings.enableQuickBar} onChange={(v) => update({ enableQuickBar: v })} />
        <Toggle label="Highlights & annotations on pages" checked={settings.enableHighlights} onChange={(v) => update({ enableHighlights: v })} />
        <Toggle label="Auto-capture a preview screenshot" checked={settings.enableAutoScreenshot} onChange={(v) => update({ enableAutoScreenshot: v })} />
        <Toggle label="Fetch page metadata (cover, reading time)" checked={settings.enableMetadata} onChange={(v) => update({ enableMetadata: v })} />
        <label className="mt-2 block text-xs font-medium text-ink-soft">Default folder for new saves</label>
        <select className="input mt-1" value={settings.defaultCollection ?? ''} onChange={(e) => update({ defaultCollection: e.target.value || undefined })}>
          <option value="">None</option>
          {collectionsApi.collections.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Section>

      <Section title="Appearance" compact={compact}>
        <label className="block text-xs font-medium text-ink-soft">Theme</label>
        <div className="mt-1 flex gap-2">
          {(['system', 'light', 'dark'] as ThemeMode[]).map((t) => (
            <button key={t} className={`btn-outline flex-1 capitalize ${settings.theme === t ? 'border-brand/50 text-brand' : ''}`} onClick={() => update({ theme: t })}>
              {t === 'light' && <Icon name="sun" size={15} />}
              {t === 'dark' && <Icon name="moon" size={15} />}
              {t}
            </button>
          ))}
        </div>

        <label className="mt-3 block text-xs font-medium text-ink-soft">Accent</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              className={`h-8 w-8 rounded-full transition ${settings.accent === a.key ? 'ring-2 ring-offset-2 ring-offset-surface-raised' : ''}`}
              style={{ background: a.swatch, ['--tw-ring-color' as any]: a.swatch }}
              onClick={() => update({ accent: a.key as Accent })}
              title={a.label}
            />
          ))}
        </div>

        <label className="mt-3 block text-xs font-medium text-ink-soft">New-tab Home page</label>
        <select className="input mt-1" value={settings.newTabMode} onChange={(e) => update({ newTabMode: e.target.value as 'home' | 'minimal' })}>
          <option value="home">Full home (app tiles + folders)</option>
          <option value="minimal">Minimal (clock + search only)</option>
        </select>

        <label className="mt-3 block text-xs font-medium text-ink-soft">Home search engine</label>
        <select className="input mt-1" value={settings.searchEngine} onChange={(e) => update({ searchEngine: e.target.value as typeof settings.searchEngine })}>
          <option value="google">Google</option>
          <option value="duckduckgo">DuckDuckGo</option>
          <option value="bing">Bing</option>
          <option value="brave">Brave</option>
          <option value="ecosia">Ecosia</option>
        </select>

        <div className="mt-3 flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-ink-soft">Default layout</label>
            <select className="input mt-1" value={settings.view} onChange={(e) => update({ view: e.target.value as ViewMode })}>
              <option value="grid">Grid</option>
              <option value="list">List</option>
              <option value="masonry">Masonry</option>
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-ink-soft">Default sort</label>
            <select className="input mt-1" value={settings.sort} onChange={(e) => update({ sort: e.target.value as SortMode })}>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title">Title A–Z</option>
              <option value="domain">Domain</option>
              <option value="lastVisited">Recently opened</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Import & export" compact={compact} hint="One-click import from Chrome/Firefox (bookmarks HTML), Raindrop (CSV or HTML), Pocket (CSV), or a Keepsake JSON export. Imports are deduped and queued for AI filing.">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".html,.json,.csv" className="hidden" onChange={onFile} />
          <button className="btn-outline" onClick={() => fileRef.current?.click()} disabled={!authed || !!importing}>
            <Icon name="import" size={15} /> {importing ? `Importing ${importing}` : 'Import file'}
          </button>
          <button className="btn-outline" onClick={doExport} disabled={!authed}>
            <Icon name="external" size={15} /> Export JSON
          </button>
        </div>
      </Section>

      <Section title="Tools" compact={compact} hint="Tidy up your vault.">
        <button className="btn-outline" onClick={findDuplicates} disabled={!authed || deduping}>
          <Icon name="copy" size={15} /> {deduping ? 'Scanning…' : 'Find & remove duplicate links'}
        </button>
      </Section>

      {backend === 'local' && authed && (
        <Section title="Danger zone" compact={compact} hint="Local mode only. Permanently removes saved data on this device.">
          <button className="btn-outline border-red-500/40 text-red-500 hover:bg-red-500/10" onClick={wipeLocal}>
            <Icon name="trash" size={15} /> Clear all local data
          </button>
        </Section>
      )}

      {!compact && <p className="py-6 text-center text-xs text-ink-faint">Keepsake — bookmarks on steroids ✦</p>}
    </div>
  );
}

function Section({ title, hint, compact, children }: { title: string; hint?: string; compact?: boolean; children: React.ReactNode }) {
  return (
    <section className={`card ${compact ? 'mb-3 p-4' : 'mb-4 p-5'}`}>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-ink-faint">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-sm text-ink-soft">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function Radio({ checked, onChange, label, sub }: { checked: boolean; onChange: () => void; label: string; sub?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-soft">
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 accent-brand" />
      <span>
        {label}
        {sub && <span className="block text-xs text-ink-faint">{sub}</span>}
      </span>
    </label>
  );
}
