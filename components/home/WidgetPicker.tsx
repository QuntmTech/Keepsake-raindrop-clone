import { useEffect, useState } from 'react';
import { WIDGETS, type WidgetKey, widgetCollapsedStore, widgetLayoutStore } from '@/lib/widgets';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';

// Widget card background presets (transparent-ish tints that read on any
// wallpaper) plus pure white/dark. '' = themed default (frosted/solid).
const CARD_COLORS = ['', '#ffffff', '#0f172a', '#1e293b', '#312e81', '#0c4a6e', '#134e4a', '#4a044e'];

// A small popover to turn dashboard widgets on/off, recolor the cards, and
// reset their layout. Widgets that need an optional host permission (weather)
// request it on enable and only stick if the user grants it — so a default
// install makes zero external calls.
export function WidgetPicker({
  enabled,
  onChange,
  color,
  onColor,
  headBtn,
}: {
  enabled: WidgetKey[];
  onChange: (next: WidgetKey[]) => void;
  color: string;
  onColor: (hex: string) => void;
  headBtn: string;
}) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const has = (k: WidgetKey) => enabled.includes(k);

  // Escape closes the popover (matches the wallpaper picker + folder popups).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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

  async function resetLayout() {
    try {
      // Reset both coordinates and collapsed state. Previously the button reset
      // positions only, so minimized widgets could still make a supposedly
      // fresh layout look broken or incomplete.
      await Promise.all([widgetLayoutStore.setValue({}), widgetCollapsedStore.setValue([])]);
      toast('Widget layout reset', 'success');
      setOpen(false);
    } catch {
      toast('Could not reset the widget layout', 'error');
    }
  }

  return (
    <div className="relative">
      <button className={headBtn} onClick={() => setOpen((o) => !o)} title="Customize widgets">
        <Icon name="masonry" size={18} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 max-h-[80vh] w-64 overflow-y-auto rounded-xl border border-line bg-surface-raised p-2 shadow-float">
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

            <p className="px-2 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Card color</p>
            <div className="flex flex-wrap items-center gap-1.5 px-2">
              {CARD_COLORS.map((c) => (
                <button
                  key={c || 'default'}
                  className={`h-6 w-6 rounded-md border transition hover:scale-110 ${
                    color === c ? 'border-brand ring-2 ring-brand' : 'border-line'
                  }`}
                  style={{ background: c || 'transparent' }}
                  onClick={() => onColor(c)}
                  title={c || 'Default (frosted)'}
                >
                  {!c && <span className="text-[8px] text-ink-faint">auto</span>}
                </button>
              ))}
              <label
                className="grid h-6 w-6 cursor-pointer place-items-center rounded-md border border-line text-ink-faint hover:text-brand"
                title="Pick any color"
              >
                <Icon name="plus" size={12} />
                <input
                  type="color"
                  className="sr-only"
                  value={/^#/.test(color) ? color : '#1e293b'}
                  onChange={(e) => onColor(e.target.value)}
                />
              </label>
            </div>

            <button
              className="mt-3 w-full rounded-lg border border-line py-1.5 text-xs text-ink-soft hover:border-brand/50 hover:text-brand"
              onClick={resetLayout}
            >
              Reset widget layout
            </button>
            <p className="px-2 pb-1 pt-2 text-[11px] leading-tight text-ink-faint">
              Tip: hover a widget and drag its <b>grip</b> (top-right) to move it anywhere.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
