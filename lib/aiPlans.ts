export type HostedAiPlan = 'free' | 'pro' | 'max' | 'owner';

export interface HostedAiPlanPolicy {
  key: HostedAiPlan;
  label: string;
  dailyCredits: number | null;
  monthlyCredits: number | null;
  customSelectionActions: number | null;
  modelAccess: string;
}

export const HOSTED_AI_PLAN_POLICIES: Record<HostedAiPlan, HostedAiPlanPolicy> = {
  free: {
    key: 'free',
    label: 'Free',
    dailyCredits: 15,
    monthlyCredits: null,
    customSelectionActions: 2,
    modelAccess: 'Economy models',
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    dailyCredits: null,
    monthlyCredits: 2_500,
    customSelectionActions: 10,
    modelAccess: 'Economy + balanced',
  },
  max: {
    key: 'max',
    label: 'Max',
    dailyCredits: null,
    monthlyCredits: 10_000,
    customSelectionActions: 30,
    modelAccess: 'All models',
  },
  owner: {
    key: 'owner',
    label: 'Owner',
    dailyCredits: null,
    monthlyCredits: null,
    customSelectionActions: null,
    modelAccess: 'All models',
  },
};

export function normalizeHostedAiPlan(value?: string | null): HostedAiPlan {
  return value === 'owner' || value === 'max' || value === 'pro' ? value : 'free';
}

export function customSelectionActionLimit(plan?: string | null): number | null {
  return HOSTED_AI_PLAN_POLICIES[normalizeHostedAiPlan(plan)].customSelectionActions;
}

export function hostedAiAllowanceLabel(plan: HostedAiPlanPolicy): string {
  if (plan.dailyCredits != null) return `${plan.dailyCredits.toLocaleString()} credits/day`;
  if (plan.monthlyCredits != null) return `${plan.monthlyCredits.toLocaleString()} credits/month`;
  return 'Unlimited';
}
