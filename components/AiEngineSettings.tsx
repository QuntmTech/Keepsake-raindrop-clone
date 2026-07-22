import { useEffect, useMemo, useState } from 'react';
import { getAiSettings, setAiSettings, watchAiSettings } from '@/lib/ai';
import { KNOWN_NOVITA_MODELS } from '@/lib/modelCatalog';
import { listProviderModels, PROVIDER_DEFAULTS, testProviderKey, type ProviderModel } from '@/lib/llm';
import { type AiRouteMode, type AiSettings, type LlmProvider } from '@/lib/types';
import { Icon } from './Icon';
import { useToast } from './Toast';

const MODES: Array<{ id: AiRouteMode; label: string; sub: string }> = [
  { id: 'auto', label: 'Auto', sub: 'Best cost/quality route for each job' },
  { id: 'economy', label: 'Economy', sub: 'Lowest cost, with automatic fallback' },
  { id: 'balanced', label: 'Balanced', sub: 'Stronger reasoning for most work' },
  { id: 'best', label: 'Best', sub: 'Maximum quality first' },
];

function ModelSelect({
  label,
  value,
  fallback,
  models,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  models: ProviderModel[];
  onChange: (value: string) => void;
}) {
  const choices = useMemo(() => {
    const map = new Map<string, ProviderModel>();
    for (const model of models) map.set(model.id, model);
    if (value && !map.has(value)) map.set(value, { id: value });
    if (fallback && !map.has(fallback)) map.set(fallback, { id: fallback });
    return [...map.values()];
  }, [models, value, fallback]);

  return (
    <label className="block text-[11px] font-medium text-ink-soft">
      {label}
      <select className="input mt-1 text-xs" value={value || fallback} onChange={(event) => onChange(event.target.value)}>
        {choices.map((model) => (
          <option key={model.id} value={model.id}>
            {model.title || model.id}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AiEngineSettings({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [testing, setTesting] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    getAiSettings().then((settings) => {
      setAi(settings);
      setKeyDraft(settings.apiKey);
    });
    return watchAiSettings((settings) => {
      setAi(settings);
      setKeyDraft((current) => (current === '' || current === settings.apiKey ? settings.apiKey : current));
    });
  }, []);

  async function patch(patchValue: Partial<AiSettings>) {
    setAi(await setAiSettings(patchValue));
  }

  async function pickProvider(provider: LlmProvider) {
    const defaults = PROVIDER_DEFAULTS[provider];
    setModels([]);
    await patch({
      provider,
      fastModel: defaults.fast,
      smartModel: defaults.smart,
      bestModel: defaults.best,
      visionModel: defaults.vision,
    });
  }

  async function commitKey() {
    if (!ai) return;
    const clean = keyDraft.trim();
    if (clean !== ai.apiKey) await patch({ apiKey: clean });
  }

  async function testKey() {
    if (!ai || !keyDraft.trim()) return;
    setTesting(true);
    try {
      await commitKey();
      const ok = await testProviderKey(ai.provider, keyDraft.trim());
      toast(ok ? 'API key works!' : 'Key rejected — check it', ok ? 'success' : 'error');
      if (ok) await refreshModels();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not reach the provider', 'error');
    } finally {
      setTesting(false);
    }
  }

  async function refreshModels() {
    if (!ai || !keyDraft.trim()) return;
    setLoadingModels(true);
    try {
      const discovered = await listProviderModels(ai.provider, keyDraft.trim());
      setModels(discovered);
      toast(`${discovered.length} model${discovered.length === 1 ? '' : 's'} available`, 'success');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not load models', 'error');
    } finally {
      setLoadingModels(false);
    }
  }

  if (!ai) return <div className="rounded-xl border border-line bg-surface-raised p-4 text-xs text-ink-faint">Loading AI engine…</div>;

  const defaults = PROVIDER_DEFAULTS[ai.provider];
  const modelChoices = models.length
    ? models
    : ai.provider === 'novita'
      ? KNOWN_NOVITA_MODELS.map((model) => ({ id: model.id, title: model.label, description: model.description, contextLength: model.context }))
      : [defaults.fast, defaults.smart, defaults.best, defaults.vision].map((id) => ({ id }));

  return (
    <section className={`mb-4 rounded-xl border border-line bg-surface-raised ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand/10 text-brand"><Icon name="sparkles" size={16} /></span>
            <div>
              <h2 className="text-sm font-semibold text-ink">AI Engine</h2>
              <p className="text-[11px] text-ink-faint">Novita-first multi-model routing with direct-provider fallbacks.</p>
            </div>
          </div>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input type="checkbox" className="peer sr-only" checked={ai.enabled} onChange={(event) => patch({ enabled: event.target.checked })} />
          <span className="h-6 w-11 rounded-full bg-surface-sunken transition peer-checked:bg-brand after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
        </label>
      </div>

      {ai.enabled && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-soft">Provider</label>
            <select className="input mt-1" value={ai.provider} onChange={(event) => pickProvider(event.target.value as LlmProvider)}>
              {(Object.keys(PROVIDER_DEFAULTS) as LlmProvider[]).map((provider) => (
                <option key={provider} value={provider}>{PROVIDER_DEFAULTS[provider].label}</option>
              ))}
            </select>
            {ai.provider === 'novita' && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-faint">
                Recommended: one OpenAI-compatible key gives Keepsake access to GPT-OSS, DeepSeek, Qwen and other models. Auto mode starts cheap and escalates only when the task needs it.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-soft">API key</label>
            <div className="mt-1 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  className="input w-full pr-14 font-mono text-xs"
                  type={showKey ? 'text' : 'password'}
                  placeholder={defaults.keyHint}
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  onBlur={commitKey}
                  autoComplete="off"
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-ink-faint hover:text-ink" onClick={() => setShowKey((value) => !value)}>
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <button className="btn-outline shrink-0 px-2.5 text-xs" onClick={testKey} disabled={testing || !keyDraft.trim()}>
                {testing ? 'Testing…' : 'Test'}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-ink-faint">Stored only in this Chrome profile. It is never synced to Keepsake.</p>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-ink-soft">Default model strategy</p>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  className={`rounded-xl border p-2.5 text-left transition ${ai.routeMode === mode.id ? 'border-brand bg-brand/10' : 'border-line bg-surface hover:border-brand/40'}`}
                  onClick={() => patch({ routeMode: mode.id })}
                >
                  <span className={`text-xs font-semibold ${ai.routeMode === mode.id ? 'text-brand' : 'text-ink'}`}>{mode.label}</span>
                  <span className="mt-0.5 block text-[9px] leading-snug text-ink-faint">{mode.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {ai.provider === 'novita' && (
            <div className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <div><p className="text-xs font-semibold text-ink">Model ladder</p><p className="text-[10px] text-ink-faint">Live from Novita when available; safe defaults remain offline.</p></div>
                <button className="btn-ghost shrink-0 px-2 text-[10px]" onClick={refreshModels} disabled={loadingModels || !keyDraft.trim()}>
                  <Icon name="refresh" size={12} /> {loadingModels ? 'Loading…' : 'Refresh'}
                </button>
              </div>
              <div className="mt-3 space-y-2">
                <ModelSelect label="Economy · high-frequency writing and filing" value={ai.fastModel} fallback={defaults.fast} models={modelChoices} onChange={(value) => patch({ fastModel: value })} />
                <ModelSelect label="Balanced · page, transcript and library reasoning" value={ai.smartModel} fallback={defaults.smart} models={modelChoices} onChange={(value) => patch({ smartModel: value })} />
                <ModelSelect label="Best · difficult escalation" value={ai.bestModel} fallback={defaults.best} models={modelChoices} onChange={(value) => patch({ bestModel: value })} />
                <ModelSelect label="Vision · screenshots and document images" value={ai.visionModel} fallback={defaults.vision} models={modelChoices} onChange={(value) => patch({ visionModel: value })} />
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={ai.showUsage} onChange={(event) => patch({ showUsage: event.target.checked })} />
            <span><span className="block text-xs font-medium text-ink">Show model, speed, tokens and estimated cost</span><span className="mt-0.5 block text-[10px] text-ink-faint">Keeps routing transparent instead of hiding which model handled a job.</span></span>
          </label>

          <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
            <p className="text-xs font-semibold text-ink">Automatic organization</p>
            <label className="flex items-center justify-between gap-3 text-xs text-ink-soft"><span>Auto-file every save</span><input type="checkbox" className="h-4 w-4 accent-brand" checked={ai.autoFile} onChange={(event) => patch({ autoFile: event.target.checked })} /></label>
            <label className="flex items-center justify-between gap-3 text-xs text-ink-soft"><span>Suggest tags</span><input type="checkbox" className="h-4 w-4 accent-brand" checked={ai.autoTag} onChange={(event) => patch({ autoTag: event.target.checked })} /></label>
            <label className="flex items-center justify-between gap-3 text-xs text-ink-soft"><span>Summarize saved pages</span><input type="checkbox" className="h-4 w-4 accent-brand" checked={ai.autoSummarize} onChange={(event) => patch({ autoSummarize: event.target.checked })} /></label>
          </div>
        </div>
      )}
    </section>
  );
}
