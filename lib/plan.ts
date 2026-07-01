import { type Plan } from './types';

// Central definition of what each account tier can do. The extension reads the
// signed-in user's `plan` and gates against this. NOTE: limits are defined here
// but NOT hard-enforced yet — enforcement + Stripe billing is the next step.
// `owner` (you) and `pro` (paid) are unlimited.

export const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free',
  pro: 'Pro',
  owner: 'Owner',
};

export interface Entitlements {
  unlimited: boolean;
  maxBookmarks: number | null; // null = unlimited
  ai: boolean; // access to hosted AI features (when AI is proxied server-side)
}

export function entitlements(plan: Plan = 'free'): Entitlements {
  if (plan === 'owner' || plan === 'pro') {
    return { unlimited: true, maxBookmarks: null, ai: true };
  }
  // Free tier defaults (tune when billing ships).
  return { unlimited: false, maxBookmarks: 200, ai: false };
}

export function isUnlimited(plan?: Plan): boolean {
  return plan === 'owner' || plan === 'pro';
}

export function planLabel(plan?: Plan): string {
  return PLAN_LABEL[plan ?? 'free'];
}
