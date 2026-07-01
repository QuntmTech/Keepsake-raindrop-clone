import { SettingsPanel } from '@/components/SettingsPanel';

// The full-page options screen is just the shared SettingsPanel — the same
// component the popup and side panel render inline.
export default function App() {
  return (
    <div className="min-h-screen bg-surface-sunken">
      <SettingsPanel />
    </div>
  );
}
