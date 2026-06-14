import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { LoginForm } from '@/components/LoginForm';
import { type UiSurface } from '@/lib/types';

// Settings page. This is where the user chooses which surface the toolbar icon opens
// (popup / side panel / dashboard) and toggles features on/off.
export default function App() {
  const { ready, authed, login, logout } = useAuth();
  const { settings, update } = useSettings();

  if (!ready) return <p className="p-8 text-gray-400">Loading…</p>;

  return (
    <div className="mx-auto max-w-lg p-8 text-gray-900 dark:text-gray-100">
      <h1 className="mb-6 flex items-center gap-2 text-xl font-semibold">
        <span>💧</span> Settings
      </h1>

      {/* --- Primary surface (the key configurable behavior) --- */}
      <Section title="When I click the toolbar icon">
        <div className="flex flex-col gap-2">
          {(['popup', 'sidepanel', 'dashboard'] as UiSurface[]).map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="surface"
                checked={settings.primarySurface === s}
                onChange={() => update({ primarySurface: s })}
              />
              {label(s)}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          All three surfaces stay available — this just sets the default the icon opens.
        </p>
      </Section>

      {/* --- Feature toggles --- */}
      <Section title="Features">
        <Toggle
          label="Highlights & annotations on pages"
          checked={settings.enableHighlights}
          onChange={(v) => update({ enableHighlights: v })}
        />
        <Toggle
          label="Auto-capture a preview screenshot when saving"
          checked={settings.enableAutoScreenshot}
          onChange={(v) => update({ enableAutoScreenshot: v })}
        />
      </Section>

      {/* --- Theme --- */}
      <Section title="Theme">
        <select
          className="rounded border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          value={settings.theme}
          onChange={(e) => update({ theme: e.target.value as any })}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </Section>

      {/* --- Account --- */}
      <Section title="Account">
        {authed ? (
          <button className="rounded bg-gray-100 px-3 py-1.5 text-sm dark:bg-gray-800" onClick={logout}>
            Sign out
          </button>
        ) : (
          <LoginForm onLogin={login} />
        )}
      </Section>
    </div>
  );
}

function label(s: UiSurface) {
  return s === 'popup' ? 'Open the popup (fast save)' : s === 'sidepanel' ? 'Open the side panel' : 'Open the full dashboard tab';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h2>
      {children}
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-2 flex items-center justify-between text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
