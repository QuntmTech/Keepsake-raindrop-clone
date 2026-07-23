import { type Plan } from '@/lib/types';
import { planLabel } from '@/lib/plan';

// Small pill showing the account tier (Owner / Max / Pro / Free).
export function PlanBadge({ plan }: { plan: Plan }) {
  const style =
    plan === 'owner'
      ? 'bg-brand text-white'
      : plan === 'max'
        ? 'bg-violet-600 text-white'
        : plan === 'pro'
          ? 'bg-emerald-500 text-white'
          : 'bg-surface-sunken text-ink-soft';
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style}`}>
      {planLabel(plan)}
    </span>
  );
}
