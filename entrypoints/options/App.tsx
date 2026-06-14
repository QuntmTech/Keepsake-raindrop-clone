import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useCollections } from '@/hooks/useCollections';
import { LoginForm } from '@/components/LoginForm';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { ACCENTS } from '@/lib/theme';
import { type Accent, type AiSettings, type ThemeMode, type UiSurface } from '@/lib/types';
import { getAiSettings, setAiSettings, testApiKey } from '@/lib/ai';
import { getBackendMode, setBackendMode, type BackendMode } from '@/lib/backend';
import { parseNetscapeHtml, parseKeepsakeJson, importItems, exportJson } from '@/lib/importer';
import { searchBookmarks } from '@/lib/bookmarks';

export default function App() {
  const { ready, authed, email, login, signup, logout } = useAuth();
  const { settings, update } = useSettings();
  const collectionsApi = useCollections(authed);
  const { toast } = useToast();

  const [ai, setAi] = useState<AiSettings | null>(null);
  const [backend, setBackend] = useState<BackendMode>('local');
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAiSettings().then(setAi);
    getBackendMode().then(setBackend);
  }, []);

  const patchAi = async (p: Partial<AiSettings>) => setAi(await setAiSettings(p));

  async function runTest() {
    if (!ai?.apiKey) return;
    setTesting(true);
    try {
      const ok = await testApiKey(ai.apiKey, ai.fastModel);
      toast(ok ? 'API key works!' : 'Key rejected — check it', ok ? 'success' : 'error');
    } catch {
      toast('Could not reach the API', 'error');
    } finally {
      setTesting(false);
    }
  }

  async function changeBackend(mode: BackendMode) {
    await setBackendMode(mode);
    setBackend(mode);
    toast(`Switched to ${mode === 'local' ? 'local storage' : 'PocketBase'} — reload surfaces`, 'info');
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const items = file.name.endsWith('.json') ? parseKeepsakeJson(text) : parseNetscapeHtml(text);
    if (items.length === 0) {
      toast('No bookmarks found in that file', 'error');
      return;
    }
    setImporting(`0 / ${items.length}`);
    const res = await importItems(items, settings.defaultCollection, (p) =>
      setImporting(`${p.done} / ${p.total}`),
    );
    setImporting(null);
    toast(`Imported ${res.done - res.failed} bookmarks`, 'success');
    collectionsApi.refresh();
    if (fileRef.current) fileRef.current.value = '';
  }

  async function doExport() {
    const all = await searchBookmarks('', { perPage: 9999 });
    const blob = exportJson(all);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keepsake-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${all.length} bookmarks`, 'success');
  }

  if (!ready) return <div className="grid h-screen place-items-center text-ink-faint">Loading…</div>;

  return (
    <div className="min-h-screen bg-surface-sunken py-10">
      <div className="mx-auto max-w-2xl px-6">
        <h1 className="mb-6 flex items-center gap-2 text-xl font-semibold text-ink">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white">
            <Icon name="settings" size={18} />
          </span>
          Keepsake Settings
        </h1>

        {/* Account */}
        <Section title="Account">
          {authed ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-brand/10 font-semibold uppercase text-brand">
                  {email?.[0] ?? '?'}
                </span>
                {email}
              </div>
              <button className="btn-outline" onClick={logout}>
                <Icon name="logout" size={15} /> Sign out
              </button>
            </div>
          ) : (
            <LoginForm onLogin={login} onSignup={signup} compact />
          )}
        </Section>

        {/* Storage backend */}
        <Section title="Storage" hint="Where your bookmarks live. Local works instantly with no server; switch to PocketBase once your database is set up.">
          <div className="flex flex-col gap-2">
            <Radio
              checked={backend === 'local'}
              onChange={() => changeBackend('local')}
              label="On this device (local storage)"
              sub="Fully functional, no setup. Data stays in your browser profile."
            />
            <Radio
              checked={backend === 'pocketbase'}
              onChange={() => changeBackend('pocketbase')}
              label="PocketBase server"
              sub="Syncs across devices. Requires WXT_PB_URL + collections (see README)."
            />
          </div>
        </Section>

        {/* Primary surface */}
        <Section title="When I click the toolbar icon">
          <div className="flex flex-col gap-2">
            {(['popup', 'sidepanel', 'dashboard'] as UiSurface[]).map((s) => (
              <Radio
                key={s}
                checked={settings.primarySurface === s}
                onChange={() => update({ primarySurface: s })}
                label={
                  s === 'popup' ? 'Open the quick-save popup' : s === 'sidepanel' ? 'Open the side panel' : 'Open the full dashboard'
                }
              />
            ))}
          </div>
        </Section>

        {/* AI */}
        <Section title="AI" hint="Bring your own Anthropic API key. It is stored locally on this device and only sent to the model API.">
          {ai && (
            <div className="flex flex-col gap-3">
              <Toggle label="Enable AI features" checked={ai.enabled} onChange={(v) => patchAi({ enabled: v })} />
              {ai.enabled && (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      className="input font-mono text-xs"
                      type="password"
                      placeholder="sk-ant-…"
                      value={ai.apiKey}
                      onChange={(e) => patchAi({ apiKey: e.target.value })}
                    />
                    <button className="btn-outline whitespace-nowrap" onClick={runTest} disabled={testing || !ai.apiKey}>
                      {testing ? 'Testing…' : 'Test key'}
                    </button>
                  </div>
                  <p className="text-xs text-ink-faint">
                    Get a key at console.anthropic.com. Auto-tagging & summaries use{' '}
                    <code className="rounded bg-surface-sunken px-1">{ai.fastModel}</code>; Ask-your-library uses{' '}
                    <code className="rounded bg-surface-sunken px-1">{ai.smartModel}</code>.
                  </p>
                  <Toggle label="Auto-suggest tags on save" checked={ai.autoTag} onChange={(v) => patchAi({ autoTag: v })} />
                  <Toggle label="Auto-summarize pages on save" checked={ai.autoSummarize} onChange={(v) => patchAi({ autoSummarize: v })} />
                </>
              )}
            </div>
          )}
        </Section>

        {/* Features */}
        <Section title="Capture">
          <Toggle label="Highlights & annotations on pages" checked={settings.enableHighlights} onChange={(v) => update({ enableHighlights: v })} />
          <Toggle label="Auto-capture a preview screenshot" checked={settings.enableAutoScreenshot} onChange={(v) => update({ enableAutoScreenshot: v })} />
          <Toggle label="Fetch page metadata (cover, reading time)" checked={settings.enableMetadata} onChange={(v) => update({ enableMetadata: v })} />
          <label className="mt-2 block text-xs font-medium text-ink-soft">Default collection for new saves</label>
          <select
            className="input mt-1"
            value={settings.defaultCollection ?? ''}
            onChange={(e) => update({ defaultCollection: e.target.value || undefined })}
          >
            <option value="">None</option>
            {collectionsApi.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <label className="block text-xs font-medium text-ink-soft">Theme</label>
          <div className="mt-1 flex gap-2">
            {(['system', 'light', 'dark'] as ThemeMode[]).map((t) => (
              <button
                key={t}
                className={`btn-outline flex-1 capitalize ${settings.theme === t ? 'border-brand/50 text-brand' : ''}`}
                onClick={() => update({ theme: t })}
              >
                {t === 'light' && <Icon name="sun" size={15} />}
                {t === 'dark' && <Icon name="moon" size={15} />}
                {t}
              </button>
            ))}
          </div>

          <label className="mt-3 block text-xs font-medium text-ink-soft">Accent</label>
          <div className="mt-1 flex gap-2">
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
        </Section>

        {/* Import / Export */}
        <Section title="Import & export" hint="Import a browser/raindrop.io bookmarks HTML file or a Keepsake JSON export.">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".html,.json" className="hidden" onChange={onFile} />
            <button className="btn-outline" onClick={() => fileRef.current?.click()} disabled={!authed || !!importing}>
              <Icon name="import" size={15} /> {importing ? `Importing ${importing}` : 'Import file'}
            </button>
            <button className="btn-outline" onClick={doExport} disabled={!authed}>
              <Icon name="external" size={15} /> Export JSON
            </button>
          </div>
        </Section>

        <p className="py-6 text-center text-xs text-ink-faint">Keepsake — bookmarks on steroids ✦</p>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card mb-4 p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-xs text-ink-faint">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1 text-sm text-ink-soft">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition ${checked ? 'bg-brand' : 'bg-line'}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function Radio({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  sub?: string;
}) {
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
