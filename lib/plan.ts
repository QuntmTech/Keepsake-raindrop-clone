import { type Plan } from './types';
import { limitsFor } from './entitlements';

// Thin, back-compatible façade over the data-driven entitlements module
// (lib/entitlements.ts). This file used to hardcode the limits (200 bookmarks,
// ai on/off); those literals now live ONLY in lib/entitlements.ts's
// DEFAULT_PLANS and, authoritatively, in the PocketBase `plans` config. Nothing
// here — or in any component — should carry a magic limit number.

export const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  max: 'Max',
  owner: 'Owner',
};

export function planLabel(plan?: Plan): string {
  return PLAN_LABEL[plan ?? 'free'];
}

export function isUnlimited(plan?: Plan): boolean {
  return limitsFor(plan ?? 'free').maxBookmarks == null;
}

// Back-compat shape for older callers. Derived from the data-driven limits, not
// hardcoded. Prefer importing from lib/entitlements.ts directly in new code.
export interface Entitlements {
  unlimited: boolean;
  maxBookmarks: number | null;
  ai: boolean;
}

export function entitlements(plan: Plan = 'free'): Entitlements {
  const l = limitsFor(plan);
  return { unlimited: l.maxBookmarks == null, maxBookmarks: l.maxBookmarks, ai: l.hostedAi };
}
