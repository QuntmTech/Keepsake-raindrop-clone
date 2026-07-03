import { useState } from 'react';
import { WIDGETS, type WidgetKey } from '@/lib/widgets';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';

// A small popover to turn dashboard widgets on/off. Widgets that need an
// optional host permission (weather) request it on enable and only stick if
// the user grants it — so a default install makes zero external calls.
export function WidgetPicker({
  enabled,
  onChange,
  headBtn,
}: {
  enabled: WidgetKey[];
  onChange: (next: WidgetKey[]) => void;
  headBtn: string;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const has = (k: WidgetKey) => enabled.includes(k);

  async function toggle(k: WidgetKey) {
    const meta = WIDGETS.find((w) => w.key === k)!;
    if (has(k)) {
      onChange(enabled.filter((x) => x !== k));
      return;
    }
    // Enabling: request any optional host permission first (needs this click).
    if (meta.needsHost?.length) {
      try {
        const granted = await browser.permissions.request({ origins: meta.needsHost });
        if (!granted) {
          toast('Weather needs network access to work', 'info');
          return;
        }
      } catch {
        toast('Could not enable that widget', 'error');
        return;
      }
    }
    onChange([...enabled, k]);
  }

  return (
    <div className="relative">
      <button className={headBtn} onClick={() => setOpen((o) => !o)} title="Customize widgets">
        <Icon name="masonry" size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-64 rounded-xl border border-line bg-surface-raised p-2 shadow-float">
            <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Home widgets</p>
            {WIDGETS.map((w) => (
              <label
                key={w.key}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-sunken"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={has(w.key)}
                  onChange={() => toggle(w.key)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{w.label}</span>
                  <span className="block text-[11px] leading-tight text-ink-faint">{w.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
