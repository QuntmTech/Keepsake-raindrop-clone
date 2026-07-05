import { useEffect, useState } from 'react';
import { getBackend } from '@/lib/backend';
import { type BillingConfig, type BillingEvent, type PlanConfigRow } from '@/lib/backend/types';
import { Icon } from './Icon';
import { useToast } from './Toast';

// Owner-only billing admin. The one operationally-dangerous control is the
// test↔live switch: it flips a single `stripe_mode` flag in PocketBase, and the
// BACKEND reads that flag to choose which SECRET key (server env) to use. This
// panel only ever touches PUBLIC publishable keys (pk_…). It refuses to store
// or even accept a secret key (sk_…) — enforced both by the input guard here
// and, authoritatively, by owner-scoped rules server-side.
//
// Rendered only when HOSTED && plan === 'owner' (see SettingsPanel). This
// client gate is UX; the server is the real boundary.

function maskKey(k: string): string {
  const t = (k ?? '').trim();
  if (!t) return '— not set —';
  if (t.length <= 14) return t;
  return `${t.slice(0, 10)}…${t.slice(-4)}`;
}

function fmtTime(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}

export function AdminBilling() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<BillingConfig | null | undefined>(undefined); // undefined=loading, null=not set up
  const [plans, setPlans] = useState<PlanConfigRow[]>([]);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [pkDraft, setPkDraft] = useState('');
  const [editingPk, setEditingPk] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pkErr, setPkErr] = useState<string | null>(null);

  async function load() {
    try {
      const b = await getBackend();
      const cfg = (await b.getBillingConfig?.()) ?? null;
      setConfig(cfg);
      setPkDraft(cfg ? (cfg.mode === 'live' ? cfg.pkLive : cfg.pkTest) : '');
      setPlans((await b.fetchPlans?.()) ?? []);
      setEvents((await b.recentBillingEvents?.(15)) ?? []);
    } catch {
      setConfig(null);
    }
  }
  useEffect(() => {
    if (open) load();
  }, [open]);

  async function applyMode(mode: 'test' | 'live') {
    setBusy(true);
    try {
      const b = await getBackend();
      const updated = await b.updateBillingConfig?.({ mode });
      if (updated) {
        setConfig(updated);
        if (!editingPk) setPkDraft(mode === 'live' ? updated.pkLive : updated.pkTest);
      }
      toast(mode === 'live' ? 'Switched to LIVE — real cards will now be charged' : 'Switched to TEST mode', mode === 'live' ? 'info' : 'success');
    } catch (e) {
      toast((e as Error)?.message || 'Could not change mode', 'error');
    } finally {
      setBusy(false);
      setConfirmLive(false);
    }
  }

  async function savePk() {
    const v = pkDraft.trim();
    setPkErr(null);
    // Hard client guard — a secret key must never be sent or stored here.
    if (/^sk_/i.test(v) || /^rk_/i.test(v)) {
      setPkErr('That is a SECRET key. NEVER enter secret keys here — they live only in the server environment and would be a serious leak if stored.');
      return;
    }
    if (v && !/^pk_/i.test(v)) {
      setPkErr('Publishable keys start with pk_ (pk_test_… or pk_live_…).');
      return;
    }
    setBusy(true);
    try {
      const b = await getBackend();
      const patch: Partial<BillingConfig> = config?.mode === 'live' ? { pkLive: v } : { pkTest: v };
      const updated = await b.updateBillingConfig?.(patch);
      if (updated) setConfig(updated);
      setEditingPk(false);
      toast('Publishable key saved', 'success');
    } catch (e) {
      toast((e as Error)?.message || 'Could not save the key', 'error');
    } finally {
      setBusy(false);
    }
  }

  const mode = config?.mode ?? 'test';
  const activePk = config ? (mode === 'live' ? config.pkLive : config.pkTest) : '';

  return (
    <section className="card mb-4 border-amber-500/30 p-5">
      <button className="flex w-full items-center justify-between" onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="settings" size={15} /> Billing admin
          <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
            Owner only
          </span>
        </span>
        <span className="text-ink-faint">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-4 flex flex-col gap-4">
          {config === undefined && <p className="text-xs text-ink-faint">Loading…</p>}

          {config === null && (
            <p className="rounded-lg bg-surface-sunken p-3 text-xs text-ink-faint">
              Billing backend isn’t set up yet. Once the PocketBase <code>stripe_mode</code> config row exists (and
              you’re signed in as the owner), this panel controls the test/live switch and shows recent events.
            </p>
          )}

          {config && (
            <>
              {/* ── Mode switch ── */}
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-ink-soft">Stripe mode:</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                      mode === 'live' ? 'bg-red-500 text-white' : 'bg-amber-500/20 text-amber-600'
                    }`}
                  >
                    {mode === 'live' ? '● LIVE — real charges' : '○ Test'}
                  </span>
                </div>

                {mode === 'test' ? (
                  !confirmLive ? (
                    <button className="btn-outline mt-2 border-red-500/40 text-red-500 hover:bg-red-500/10" onClick={() => setConfirmLive(true)} disabled={busy}>
                      Go live →
                    </button>
                  ) : (
                    <div className="mt-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
                      <p className="text-xs font-medium text-red-600">
                        ⚠ You are about to go LIVE — real cards will be charged. Make sure your live secret key and
                        webhook are configured on the server first.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button className="btn-ghost flex-1" onClick={() => setConfirmLive(false)} disabled={busy}>
                          Cancel
                        </button>
                        <button className="btn-primary flex-1 bg-red-500 hover:bg-red-600" onClick={() => applyMode('live')} disabled={busy}>
                          {busy ? 'Switching…' : 'Yes, go LIVE'}
                        </button>
                      </div>
                    </div>
                  )
                ) : (
                  <button className="btn-outline mt-2" onClick={() => applyMode('test')} disabled={busy}>
                    ← Switch back to test mode
                  </button>
                )}
              </div>

              {/* ── Publishable key (public) ── */}
              <div>
                <label className="text-xs font-medium text-ink-soft">
                  Active publishable key ({mode})
                </label>
                {!editingPk ? (
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 truncate rounded-lg bg-surface-sunken px-2 py-1.5 font-mono text-xs text-ink-soft">
                      {maskKey(activePk)}
                    </code>
                    <button className="btn-outline px-2.5 text-xs" onClick={() => { setPkDraft(activePk); setEditingPk(true); setPkErr(null); }}>
                      Edit
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        className="input flex-1 font-mono text-xs"
                        placeholder={mode === 'live' ? 'pk_live_…' : 'pk_test_…'}
                        value={pkDraft}
                        onChange={(e) => setPkDraft(e.target.value)}
                        autoFocus
                      />
                      <button className="btn-primary px-3 text-xs" onClick={savePk} disabled={busy}>Save</button>
                      <button className="btn-ghost px-2 text-xs" onClick={() => { setEditingPk(false); setPkErr(null); }}>Cancel</button>
                    </div>
                    {pkErr && <p className="text-xs text-red-500">{pkErr}</p>}
                  </div>
                )}
                <p className="mt-1.5 flex items-start gap-1 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-700">
                  <span>🔒</span>
                  <span>
                    Publishable keys (<code>pk_…</code>) only — they’re public and safe here. <b>Never</b> paste a
                    secret key (<code>sk_…</code>): secret keys live only in the server’s environment variables and
                    are never entered, displayed, or stored in this panel.
                  </span>
                </p>
              </div>

              {/* ── Plan / price config (read-only) ── */}
              <div>
                <p className="text-xs font-medium text-ink-soft">Plans &amp; prices <span className="text-ink-faint">(read-only — edit in PocketBase)</span></p>
                <div className="mt-1 overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-surface-sunken text-ink-faint">
                      <tr>
                        <th className="px-2 py-1 font-medium">Plan</th>
                        <th className="px-2 py-1 font-medium">Monthly price id</th>
                        <th className="px-2 py-1 font-medium">Annual price id</th>
                        <th className="px-2 py-1 font-medium">Hosted AI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plans.length === 0 && (
                        <tr><td className="px-2 py-2 text-ink-faint" colSpan={4}>No plans config found.</td></tr>
                      )}
                      {plans.map((p) => (
                        <tr key={p.key} className="border-t border-line">
                          <td className="px-2 py-1 font-medium capitalize text-ink">{p.key}</td>
                          <td className="px-2 py-1 font-mono text-ink-soft">{p.stripe_price_month || '—'}</td>
                          <td className="px-2 py-1 font-mono text-ink-soft">{p.stripe_price_year || '—'}</td>
                          <td className="px-2 py-1 text-ink-soft">{p.hosted_ai ? 'yes' : 'no'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Recent events (read-only) ── */}
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-ink-soft">Recent Stripe events</p>
                  <button className="text-[11px] text-ink-faint hover:text-brand" onClick={load}>Refresh</button>
                </div>
                <div className="mt-1 max-h-40 overflow-auto rounded-lg border border-line">
                  {events.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-ink-faint">No events yet (or the webhook_events collection isn’t set up).</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {events.map((e) => (
                        <li key={e.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[11px]">
                          <span className="font-mono text-ink-soft">{e.type}</span>
                          <span className="flex items-center gap-2 text-ink-faint">
                            {e.handled === false && <span className="text-amber-600">unhandled</span>}
                            {fmtTime(e.created)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
