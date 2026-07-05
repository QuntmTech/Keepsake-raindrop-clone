import { storage } from 'wxt/utils/storage';
import { getBackend, HOSTED } from './backend';
import { type Plan } from './types';
import { type PlanConfigRow } from './backend/types';

// ── The ONE source of truth for plan LIMITS + entitlement checks ─────────────
//
// Limits are DATA-DRIVEN: read from the PocketBase `plans` config collection,
// cached, and refreshed periodically. When PB is unreachable — offline, or
// before the backend collection exists — we fall back to the bundled
// DEFAULT_PLANS below (which mirror launch pricing and are also the values to
// SEED into PB). PocketBase is authoritative when reachable.
//
// The client's checks here are UX guardrails and are bypassable; the real,
// authoritative enforcement lives server-side in PocketBase (see the Phase 5
// handoff). Nothing in this module hardcodes limits into components — every
// consumer reads through limitsFor()/the can*() helpers.
//
// Local mode: local accounts are provisioned as `owner` (unlimited), so local
// installs are never gated regardless of this config.

export type CaptureTier = 'basic' | 'full';

export interface PlanLimits {
  maxBookmarks: number | null; // null = unlimited
  maxWatches: number | null; // null = unlimited
  maxStorageBytes: number | null; // null = unlimited
  hostedAi: boolean; // access to hosted (no-key) AI; metered server-side
  aiCreditAllowance: number | null; // monthly hosted-AI credits; null = unlimited
  captureTier: CaptureTier; // 'basic' = single-area screenshot; 'full' = Capture Studio
  stripePriceMonth: string; // Stripe price id (from PB config; empty in defaults)
  stripePriceYear: string;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

// Placeholder monthly hosted-AI credit grant for Pro — the owner tunes the real
// number in the PB `plans` config; this is only the offline/first-run fallback.
export const PRO_AI_CREDIT_ALLOWANCE_DEFAULT = 1000;

// Bundled fallback limits (also the launch values to seed into PB `plans`).
// Owner is intentionally all-unlimited and never read from config.
export const DEFAULT_PLANS: Record<Plan, PlanLimits> = {
  free: {
    maxBookmarks: 200,
    maxWatches: 3,
    maxStorageBytes: 100 * MB,
    hostedAi: false,
    aiCreditAllowance: 0,
    captureTier: 'basic',
    stripePriceMonth: '',
    stripePriceYear: '',
  },
  pro: {
    maxBookmarks: null,
    maxWatches: 25,
    maxStorageBytes: 10 * GB,
    hostedAi: true,
    aiCreditAllowance: PRO_AI_CREDIT_ALLOWANCE_DEFAULT,
    captureTier: 'full',
    stripePriceMonth: '',
    stripePriceYear: '',
  },
  owner: {
    maxBookmarks: null,
    maxWatches: null,
    maxStorageBytes: null,
    hostedAi: true,
    aiCreditAllowance: null,
    captureTier: 'full',
    stripePriceMonth: '',
    stripePriceYear: '',
  },
};

// In-memory active limits, seeded with the bundled defaults and overwritten
// when the PB config loads. limitsFor() reads this synchronously.
let activeLimits: Record<Plan, PlanLimits> = cloneDefaults();
let hydrated = false;

function cloneDefaults(): Record<Plan, PlanLimits> {
  return {
    free: { ...DEFAULT_PLANS.free },
    pro: { ...DEFAULT_PLANS.pro },
    owner: { ...DEFAULT_PLANS.owner },
  };
}

interface CachedConfig {
  plans: Partial<Record<'free' | 'pro', PlanLimits>>;
  fetchedAt: number;
}
const configStore = storage.defineItem<CachedConfig | null>('sync:plans_config', { fallback: null });
const CONFIG_TTL = 30 * 60_000; // refetch the plans config at most every 30 min

// Cap fields: a positive number is a real cap; empty/0/absent means unlimited
// (PocketBase number fields default to 0, so treat 0 as "no cap" for caps).
function capField(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function mapRow(row: PlanConfigRow): PlanLimits {
  return {
    maxBookmarks: capField(row.max_bookmarks),
    maxWatches: capField(row.max_watches),
    maxStorageBytes: capField(row.max_storage_bytes),
    hostedAi: Boolean(row.hosted_ai),
    // Credit allowance keeps an explicit 0 (Free has 0); null = unlimited.
    aiCreditAllowance: row.ai_credit_allowance == null ? null : Number(row.ai_credit_allowance),
    captureTier: row.capture_tier === 'full' ? 'full' : 'basic',
    stripePriceMonth: row.stripe_price_month || '',
    stripePriceYear: row.stripe_price_year || '',
  };
}

function applyPlans(plans: Partial<Record<'free' | 'pro', PlanLimits>>): void {
  activeLimits = {
    free: { ...DEFAULT_PLANS.free, ...(plans.free ?? {}) },
    pro: { ...DEFAULT_PLANS.pro, ...(plans.pro ?? {}) },
    owner: { ...DEFAULT_PLANS.owner }, // owner is always bundled-unlimited
  };
}

async function hydrateFromCache(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const cached = await configStore.getValue();
    if (cached?.plans) applyPlans(cached.plans);
  } catch {
    /* keep bundled defaults */
  }
}

let inflight: Promise<void> | null = null;

// Ensure the plans config is loaded (cache first, then PB when stale). Safe to
// call often; the network fetch is throttled by CONFIG_TTL and de-duped.
export async function loadEntitlementsConfig(force = false): Promise<void> {
  await hydrateFromCache();
  if (!HOSTED) return; // local mode: bundled defaults; local users are 'owner'
  const cached = await configStore.getValue().catch(() => null);
  if (!force && cached && Date.now() - cached.fetchedAt < CONFIG_TTL) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const backend = await getBackend();
      const rows = (await backend.fetchPlans?.()) ?? [];
      if (rows.length) {
        const plans: Partial<Record<'free' | 'pro', PlanLimits>> = {};
        for (const r of rows) {
          if (r.key === 'free' || r.key === 'pro') plans[r.key] = mapRow(r);
        }
        applyPlans(plans);
        await configStore.setValue({ plans, fetchedAt: Date.now() });
      }
    } catch {
      /* offline / collection missing → keep cache or bundled defaults */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Synchronous limits accessor (uses whatever config is loaded; defaults until
// loadEntitlementsConfig() has run).
export function limitsFor(plan: Plan): PlanLimits {
  return activeLimits[plan] ?? DEFAULT_PLANS[plan] ?? DEFAULT_PLANS.free;
}

// The current signed-in plan. Unknown / logged-out / errored → Free (the safe
// default). Local accounts resolve to 'owner' (unlimited).
async function currentPlan(): Promise<Plan> {
  try {
    return (await getBackend()).currentUser()?.plan ?? 'free';
  } catch {
    return 'free';
  }
}

export interface Entitlement {
  plan: Plan;
  limits: PlanLimits;
}

export async function getEntitlements(): Promise<Entitlement> {
  await loadEntitlementsConfig();
  const plan = await currentPlan();
  return { plan, limits: limitsFor(plan) };
}

export interface CapState {
  allowed: boolean;
  unlimited: boolean;
  plan: Plan;
  limit: number | null;
  used: number;
}

// Whether another cloud bookmark may be saved. Only meaningful in hosted mode;
// unlimited plans (Pro/Owner, and all of local mode) always pass. The count
// comes from vaultStats().total, which already EXCLUDES Home launcher tiles —
// matching the counting rule (real pages + cloud captures count; tiles never).
export async function canSaveBookmark(): Promise<CapState> {
  const { plan, limits } = await getEntitlements();
  if (limits.maxBookmarks == null) return { allowed: true, unlimited: true, plan, limit: null, used: 0 };
  let used = 0;
  try {
    const { vaultStats } = await import('./bookmarks');
    used = (await vaultStats()).total;
  } catch {
    used = 0; // count unknown → don't hard-block a guardrail (server is authoritative)
  }
  return { allowed: used < limits.maxBookmarks, unlimited: false, plan, limit: limits.maxBookmarks, used };
}

export async function canCreateWatch(): Promise<CapState> {
  const { plan, limits } = await getEntitlements();
  if (limits.maxWatches == null) return { allowed: true, unlimited: true, plan, limit: null, used: 0 };
  let used = 0;
  try {
    const { watchedSaves } = await import('./watch');
    used = (await watchedSaves()).length;
  } catch {
    used = 0;
  }
  return { allowed: used < limits.maxWatches, unlimited: false, plan, limit: limits.maxWatches, used };
}

// Hosted (no-key) AI entitlement. BYOK AI is NEVER gated by this — it's always
// available. Credit metering is enforced server-side; this is the on/off gate.
export async function canUseHostedAI(): Promise<boolean> {
  const { limits } = await getEntitlements();
  return limits.hostedAi;
}

export async function captureTier(): Promise<CaptureTier> {
  return (await getEntitlements()).limits.captureTier;
}

export interface StorageState {
  used: number;
  limit: number | null;
  remaining: number | null;
  unlimited: boolean;
  estimated: boolean; // true until PB reports authoritative bytes
}

// Local, NON-authoritative storage estimate: sum of every capture blob's size
// in the IndexedDB sidecar (screenshots/recordings/MHTML snapshots — the
// large binary data behind a save). This is the best signal the client can
// compute on its own; it does NOT see bytes already synced from other devices
// or the server's actual file storage, so it always undercounts somewhat.
// Once PocketBase exposes an authoritative `usage.storage_bytes` figure, pass
// it into storageRemaining() explicitly and this estimate is bypassed.
export async function estimatedStorageBytes(): Promise<number> {
  try {
    const { db } = await import('./save');
    const blobs = await db.blobs.toArray();
    return blobs.reduce((sum, b) => sum + (b.size || 0), 0);
  } catch {
    return 0; // sidecar unavailable (content-script context, etc.) — assume no usage
  }
}

// Storage headroom. Pass `usedBytes` once PocketBase reports authoritative
// bytes; until then this falls back to the local blob-size estimate above
// (estimated:true flags that it's not server-verified).
export async function storageRemaining(usedBytes?: number): Promise<StorageState> {
  const { limits } = await getEntitlements();
  const estimated = usedBytes == null;
  const used = Math.max(0, usedBytes ?? (await estimatedStorageBytes()));
  if (limits.maxStorageBytes == null) return { used, limit: null, remaining: null, unlimited: true, estimated };
  return {
    used,
    limit: limits.maxStorageBytes,
    remaining: Math.max(0, limits.maxStorageBytes - used),
    unlimited: false,
    estimated,
  };
}

// Force a fresh read of BOTH the user's plan (the webhook may have just upgraded
// it) and the plans config. Phase 3 calls this on checkout return so a new Pro
// subscription unlocks immediately instead of waiting for the next 6h refresh.
export async function refreshEntitlements(): Promise<Entitlement> {
  try {
    await (await getBackend()).refreshUser?.();
  } catch {
    /* keep the current session */
  }
  await loadEntitlementsConfig(true);
  const plan = await currentPlan();
  return { plan, limits: limitsFor(plan) };
}
