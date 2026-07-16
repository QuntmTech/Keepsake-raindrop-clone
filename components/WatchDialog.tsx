import { useEffect, useState } from 'react';
import { getSave, type Save, type WatchFrequency, type WatchMode } from '@/lib/save';
import { canCreateWatch } from '@/lib/entitlements';
import { useEscape } from '@/hooks/useEscape';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { UpgradeDialog } from './UpgradeDialog';

// "Watch this page" (Living Bookmarks). Configure price / content /
// availability monitoring for one Save; shows price history + alert log.

const MODES: Array<{ key: WatchMode; label: string; desc: string; icon: string }> = [
  { key: 'price', label: 'Price', desc: 'Track the price, alert on drops', icon: '💰' },
  { key: 'content', label: 'Any change', desc: 'Alert when the page content changes', icon: '📝' },
  { key: 'availability', label: 'Back in stock', desc: 'Alert when it becomes available', icon: '📦' },
];
const FREQS: WatchFrequency[] = ['1h', '6h', 'daily', 'weekly'];

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 240;
  const h = 48;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p - min) / span) * (h - 6) - 3).toFixed(1)}`)
    .join(' ');
  const rising = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} className="mt-1">
      <path d={d} fill="none" stroke={rising ? '#ef4444' : '#16a34a'} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export function WatchDialog({ saveId, onClose }: { saveId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [save, setSave] = useState<Save | null>(null);
  const [mode, setMode] = useState<WatchMode>('price');
  const [frequency, setFrequency] = useState<WatchFrequency>('daily');
  const [selector, setSelector] = useState('');
  const [ruleType, setRuleType] = useState<'any-change' | 'below'>('any-change');
  const [ruleValue, setRuleValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  useEscape(onClose);

  useEffect(() => {
    getSave(saveId).then((s) => {
      if (!s) return;
      setSave(s);
      if (s.monitoring.mode) setMode(s.monitoring.mode);
      setFrequency(s.monitoring.frequency);
      setSelector(s.monitoring.selector ?? '');
      if (s.monitoring.alertRule) {
        setRuleType(s.monitoring.alertRule.type);
        setRuleValue(s.monitoring.alertRule.value != null ? String(s.monitoring.alertRule.value) : '');
      }
    });
  }, [saveId]);

  async function pick() {
    setPicking(true);
    try {
      const resp = (await browser.runtime.sendMessage({ type: 'KS_PICK_SELECTOR' })) as {
        ok: boolean;
        selector: string | null;
      };
      if (resp?.selector) {
        setSelector(resp.selector);
        toast('Element captured', 'success');
      } else {
        toast('Picker cancelled — is the watched page the active tab?', 'info');
      }
    } catch {
      toast('Could not start the picker on this page', 'error');
    } finally {
      setPicking(false);
    }
  }

  async function start() {
    // Only a NEW watch counts against the cap — updating an already-active
    // watch's settings must never be blocked.
    if (!save?.monitoring.enabled) {
      const cap = await canCreateWatch();
      if (!cap.allowed) {
        setShowUpgrade(true);
        return;
      }
    }
    setBusy(true);
    try {
      // The background wraps handler errors into a RESOLVED {ok:false,error}
      // response — the catch below only fires on transport failures. Without
      // checking ok, a failed start toasted "Watching this page" and the user
      // walked away believing a price watch was active that never checks.
      const resp = (await browser.runtime.sendMessage({
        type: 'KS_WATCH_START',
        saveId,
        cfg: {
          mode,
          frequency,
          selector: selector.trim() || undefined,
          alertRule:
            mode === 'price'
              ? { type: ruleType, value: ruleType === 'below' ? Number(ruleValue) || undefined : undefined }
              : { type: 'any-change' as const },
        },
      })) as { ok?: boolean; error?: string } | undefined;
      if (resp && resp.ok === false) throw new Error(resp.error || 'watch start failed');
      toast('Watching this page', 'success');
      onClose();
    } catch {
      toast('Could not start the watch', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    try {
      const resp = (await browser.runtime.sendMessage({ type: 'KS_WATCH_STOP', saveId })) as
        | { ok?: boolean }
        | undefined;
      if (resp && resp.ok === false) throw new Error('stop failed');
      toast('Stopped watching', 'info');
      onClose();
    } catch {
      toast('Could not stop the watch — try again', 'error');
    }
  }

  const prices = (save?.monitoring.history ?? [])
    .map((h) => Number(h.value))
    .filter((n) => Number.isFinite(n));
  const alerts = (save?.monitoring.history ?? []).filter((h) => h.note).slice(-5).reverse();
  const watching = Boolean(save?.monitoring.enabled);

  return (
    <div className="fixed inset-0 z-[2147483646] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-semibold">Watch this page</h3>
          <button className="btn-ghost px-2" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="mb-3 line-clamp-1 text-xs text-ink-faint">{save?.title ?? '…'}</p>

        <div className="flex flex-col gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition ${
                mode === m.key ? 'border-brand ring-1 ring-brand' : 'border-line hover:border-brand/40'
              }`}
              onClick={() => setMode(m.key)}
            >
              <span className="text-lg">{m.icon}</span>
              <span>
                <span className="block text-sm font-medium text-ink">{m.label}</span>
                <span className="block text-xs text-ink-faint">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>

        {mode === 'price' && (
          <div className="mt-3 flex items-center gap-2">
            <select className="input flex-1" value={ruleType} onChange={(e) => setRuleType(e.target.value as typeof ruleType)}>
              <option value="any-change">Alert on any price drop</option>
              <option value="below">Alert when below…</option>
            </select>
            {ruleType === 'below' && (
              <input
                className="input w-24"
                type="number"
                placeholder="$"
                value={ruleValue}
                onChange={(e) => setRuleValue(e.target.value)}
              />
            )}
          </div>
        )}

        <div className="mt-3">
          <label className="block text-xs font-medium text-ink-soft">
            {mode === 'price' ? 'Price element (optional — auto-detected on most shops)' : 'Watch a specific section (optional)'}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              className="input flex-1 font-mono text-xs"
              placeholder=".price, #stock-status…"
              value={selector}
              onChange={(e) => setSelector(e.target.value)}
            />
            <button className="btn-outline whitespace-nowrap" onClick={pick} disabled={picking}>
              {picking ? 'Click the page…' : 'Point at it'}
            </button>
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-xs font-medium text-ink-soft">Check frequency</label>
          <div className="mt-1 flex gap-1.5">
            {FREQS.map((f) => (
              <button
                key={f}
                className={`btn-outline flex-1 ${frequency === f ? 'border-brand/60 text-brand' : ''}`}
                onClick={() => setFrequency(f)}
              >
                {f === '1h' ? 'Hourly' : f === '6h' ? '6 h' : f === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
        </div>

        {save?.monitoring.jsRendered && (
          <p className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-600">
            This page renders with JavaScript — it re-checks automatically whenever you open it instead of on a timer.
          </p>
        )}

        {mode === 'price' && prices.length >= 2 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-ink-soft">
              Price history · now {save?.monitoring.lastValue}
            </p>
            <Sparkline points={prices} />
          </div>
        )}

        {alerts.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-ink-soft">Recent alerts</p>
            <ul className="mt-1 space-y-1">
              {alerts.map((h) => (
                <li key={h.ts} className="text-xs text-ink-faint">
                  {new Date(h.ts).toLocaleDateString()} — {h.note}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {watching && (
            <button className="btn-outline flex-1 hover:text-red-500" onClick={stop}>
              Stop watching
            </button>
          )}
          <button className="btn-primary flex-1" onClick={start} disabled={busy || !save}>
            {watching ? 'Update watch' : 'Start watching'}
          </button>
        </div>
      </div>
      {showUpgrade && <UpgradeDialog reason="watches" onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
