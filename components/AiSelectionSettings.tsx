import { useMemo } from 'react';
import {
  customSelectionActionLimit,
  hostedAiAllowanceLabel,
  HOSTED_AI_PLAN_POLICIES,
  normalizeHostedAiPlan,
} from '@/lib/aiPlans';
import { AI_SELECTION_BUILTINS, DEFAULT_AI_SELECTION_ACTIONS } from '@/lib/selectionActions';
import {
  type AiSelectionActionRef,
  type AiSelectionCustomAction,
  type Plan,
  type Settings,
} from '@/lib/types';

interface Props {
  settings: Settings;
  plan: Plan;
  compact?: boolean;
  update: (patch: Partial<Settings>) => unknown;
}

function customRef(id: string): AiSelectionActionRef {
  return `custom:${id}`;
}

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function AiSelectionSettings({ settings, plan, compact = false, update }: Props) {
  const activePlan = normalizeHostedAiPlan(String(plan));
  const customLimit = customSelectionActionLimit(String(plan));
  const activeRefs = settings.aiSelectionActions;

  const allRows = useMemo(() => {
    const builtIns = AI_SELECTION_BUILTINS.map((action) => ({
      ref: action.id as AiSelectionActionRef,
      label: action.label,
      description: `${action.description} · ${action.creditCost} hosted credit${action.creditCost === 1 ? '' : 's'}`,
      custom: false,
    }));
    const custom = settings.aiSelectionCustomActions.map((action) => ({
      ref: customRef(action.id),
      label: action.label || 'Untitled custom action',
      description: action.instruction || 'Add an instruction.',
      custom: true,
    }));
    return [...builtIns, ...custom].sort((a, b) => {
      const ai = activeRefs.indexOf(a.ref);
      const bi = activeRefs.indexOf(b.ref);
      if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [activeRefs, settings.aiSelectionCustomActions]);

  const setEnabled = (ref: AiSelectionActionRef, enabled: boolean) => {
    const next = activeRefs.filter((item) => item !== ref);
    if (enabled) next.push(ref);
    update({ aiSelectionActions: next });
  };

  const moveRef = (ref: AiSelectionActionRef, direction: -1 | 1) => {
    const index = activeRefs.indexOf(ref);
    if (index < 0) return;
    update({ aiSelectionActions: move(activeRefs, index, direction) });
  };

  const patchCustom = (id: string, patch: Partial<AiSelectionCustomAction>) => {
    update({
      aiSelectionCustomActions: settings.aiSelectionCustomActions.map((action) =>
        action.id === id ? { ...action, ...patch } : action,
      ),
    });
  };

  const addCustom = () => {
    if (customLimit != null && settings.aiSelectionCustomActions.length >= customLimit) return;
    const id = `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const action: AiSelectionCustomAction = {
      id,
      label: 'My action',
      instruction: 'Describe exactly what Keepsake should do with the selected text.',
    };
    update({
      aiSelectionCustomActions: [...settings.aiSelectionCustomActions, action],
      aiSelectionActions: [...activeRefs, customRef(id)],
    });
  };

  const removeCustom = (id: string) => {
    update({
      aiSelectionCustomActions: settings.aiSelectionCustomActions.filter((action) => action.id !== id),
      aiSelectionActions: activeRefs.filter((ref) => ref !== customRef(id)),
    });
  };

  return (
    <section className={`card ${compact ? 'mb-3 p-4' : 'mb-4 p-5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">AI selection command center</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            Choose exactly what appears when you highlight text, and disable it anywhere it gets in the way.
          </p>
        </div>
        <Switch
          label="Enable AI selection menu"
          checked={settings.enableAiSelectionTools}
          onChange={(value) => update({ enableAiSelectionTools: value })}
          compact
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {(['free', 'pro', 'max'] as const).map((key) => {
          const policy = HOSTED_AI_PLAN_POLICIES[key];
          const active = activePlan === key;
          return (
            <div
              key={key}
              className={`rounded-lg border p-2 ${active ? 'border-brand bg-brand/10' : 'border-line bg-surface-sunken'}`}
            >
              <p className={`text-[11px] font-semibold ${active ? 'text-brand' : 'text-ink'}`}>
                {policy.label}{active ? ' · Current' : ''}
              </p>
              <p className="mt-0.5 text-[10px] text-ink-faint">{hostedAiAllowanceLabel(policy)}</p>
              <p className="text-[10px] text-ink-faint">{policy.customSelectionActions} custom actions</p>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-ink-faint">
        Hosted-AI limits do not apply when users bring their own provider key.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Switch
          label="Show on selected page text"
          checked={settings.aiSelectionShowForReading}
          onChange={(value) => update({ aiSelectionShowForReading: value })}
        />
        <Switch
          label="Show inside editable fields"
          checked={settings.aiSelectionShowForWriting}
          onChange={(value) => update({ aiSelectionShowForWriting: value })}
        />
      </div>

      <label className="mt-3 block text-xs font-medium text-ink-soft">
        Translate action language
        <input
          className="input mt-1"
          maxLength={80}
          value={settings.aiSelectionTranslateLanguage}
          onChange={(event) => update({ aiSelectionTranslateLanguage: event.target.value })}
          placeholder="English"
        />
      </label>

      <div className="mt-4 flex items-end justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-ink">Menu actions</p>
          <p className="text-[10px] text-ink-faint">
            The first three enabled actions appear directly in the compact toolbar. Use arrows to reorder them.
          </p>
        </div>
        <button
          className="btn-outline px-2 text-xs"
          onClick={() => update({ aiSelectionActions: DEFAULT_AI_SELECTION_ACTIONS })}
        >
          Reset
        </button>
      </div>

      <div className="mt-2 space-y-1.5">
        {allRows.map((row) => {
          const enabled = activeRefs.includes(row.ref);
          const index = activeRefs.indexOf(row.ref);
          return (
            <div key={row.ref} className="rounded-lg border border-line bg-surface-sunken p-2">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(row.ref, event.target.checked)}
                  className="mt-0.5 accent-brand"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink">{row.label}</p>
                  <p className="truncate text-[10px] text-ink-faint">{row.description}</p>
                </div>
                {enabled && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      className="btn-ghost h-7 w-7 p-0 text-xs"
                      onClick={() => moveRef(row.ref, -1)}
                      disabled={index <= 0}
                      aria-label={`Move ${row.label} up`}
                    >
                      ↑
                    </button>
                    <button
                      className="btn-ghost h-7 w-7 p-0 text-xs"
                      onClick={() => moveRef(row.ref, 1)}
                      disabled={index < 0 || index >= activeRefs.length - 1}
                      aria-label={`Move ${row.label} down`}
                    >
                      ↓
                    </button>
                  </div>
                )}
              </div>

              {row.custom && (() => {
                const id = row.ref.slice('custom:'.length);
                const action = settings.aiSelectionCustomActions.find((item) => item.id === id);
                if (!action) return null;
                return (
                  <div className="mt-2 space-y-2 border-t border-line pt-2">
                    <input
                      className="input text-xs"
                      maxLength={40}
                      value={action.label}
                      onChange={(event) => patchCustom(id, { label: event.target.value })}
                      placeholder="Action name"
                    />
                    <textarea
                      className="input h-20 resize-y text-xs"
                      maxLength={1200}
                      value={action.instruction}
                      onChange={(event) => patchCustom(id, { instruction: event.target.value })}
                      placeholder="Tell Keepsake exactly what to do with the selected text."
                    />
                    <button
                      className="text-[10px] font-medium text-red-500 hover:underline"
                      onClick={() => removeCustom(id)}
                    >
                      Delete custom action
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <button
        className="btn-outline mt-2 w-full justify-center"
        onClick={addCustom}
        disabled={customLimit != null && settings.aiSelectionCustomActions.length >= customLimit}
      >
        Add custom action ({settings.aiSelectionCustomActions.length}/{customLimit ?? '∞'})
      </button>

      <label className="mt-4 block text-xs font-medium text-ink-soft">
        Disabled websites
        <textarea
          className="input mt-1 h-20 font-mono text-xs"
          placeholder={'mail.example.com\nwork.example.org'}
          value={settings.aiSelectionBlockedSites.join('\n')}
          onChange={(event) =>
            update({
              aiSelectionBlockedSites: event.target.value
                .split('\n')
                .map((value) => value.trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 200),
            })
          }
        />
      </label>
      <p className="mt-1 text-[10px] text-ink-faint">
        The popup’s ••• menu can also hide it for one visit, disable the current website, or turn it off everywhere.
      </p>
    </section>
  );
}

function Switch({
  label,
  checked,
  onChange,
  compact = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-2 ${compact ? '' : 'rounded-lg border border-line bg-surface-sunken p-2'} text-xs text-ink-soft`}
    >
      {!compact && <span>{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
        />
      </button>
    </label>
  );
}
