import { getAiSettings } from './ai';
import {
  estimateModelCostUsd,
  NOVITA_MODEL_IDS,
  routeNovitaModels,
  type LlmTask,
  type LlmTier,
} from './modelCatalog';
import { type AiRouteMode, type LlmProvider } from './types';

// Provider-agnostic BYOK client. Novita is the default because its OpenAI-
// compatible endpoint gives Keepsake one key for a cost ladder of current open
// models. Anthropic, OpenAI and Google remain available for users who prefer
// direct provider accounts.

export interface LlmRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  tier?: LlmTier;
  task?: LlmTask;
  routeMode?: AiRouteMode;
  temperature?: number;
  responseFormat?: 'text' | 'json';
  signal?: AbortSignal;
  attemptTimeoutMs?: number;
  overallTimeoutMs?: number;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
}

export interface LlmResult {
  text: string;
  provider: LlmProvider;
  model: string;
  latencyMs: number;
  usage?: LlmUsage;
  estimatedCostUsd?: number;
  routeReason?: string;
  fallbackCount: number;
}

export interface ProviderModel {
  id: string;
  title?: string;
  description?: string;
  inputTokenPricePerMillion?: number;
  outputTokenPricePerMillion?: number;
  contextLength?: number;
}

export const PROVIDER_DEFAULTS: Record<
  LlmProvider,
  { fast: string; smart: string; best: string; vision: string; label: string; keyHint: string }
> = {
  novita: {
    fast: NOVITA_MODEL_IDS.economy,
    smart: NOVITA_MODEL_IDS.balanced,
    best: NOVITA_MODEL_IDS.best,
    vision: NOVITA_MODEL_IDS.vision,
    label: 'Novita AI — multi-model',
    keyHint: 'Novita API key',
  },
  anthropic: {
    fast: 'claude-haiku-4-5',
    smart: 'claude-opus-4-8',
    best: 'claude-opus-4-8',
    vision: 'claude-opus-4-8',
    label: 'Anthropic (Claude)',
    keyHint: 'sk-ant-…',
  },
  openai: {
    fast: 'gpt-4o-mini',
    smart: 'gpt-4o',
    best: 'gpt-4o',
    vision: 'gpt-4o',
    label: 'OpenAI (GPT)',
    keyHint: 'sk-…',
  },
  google: {
    fast: 'gemini-2.5-flash',
    smart: 'gemini-2.5-pro',
    best: 'gemini-2.5-pro',
    vision: 'gemini-2.5-pro',
    label: 'Google (Gemini)',
    keyHint: 'AIza…',
  },
};

const REQUEST_TIMEOUT_MS = 35_000;
const OVERALL_REQUEST_TIMEOUT_MS = 75_000;
const MODEL_LIST_TIMEOUT_MS = 15_000;

class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail = '',
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

interface AdapterResult {
  text: string;
  usage?: LlmUsage;
}

type Adapter = (key: string, model: string, req: LlmRequest) => Promise<AdapterResult>;

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (active.length === 1) return active[0];
  const any = (AbortSignal as typeof AbortSignal & { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(active);

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of active) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener('abort', () => abort(signal), { once: true });
  }
  return controller.signal;
}

function timeoutSignal(timeout: number): AbortSignal {
  const signalApi = AbortSignal as typeof AbortSignal & { timeout?: (milliseconds: number) => AbortSignal };
  if (signalApi.timeout) return signalApi.timeout(timeout);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeout);
  return controller.signal;
}

function requestSignal(timeout = REQUEST_TIMEOUT_MS, external?: AbortSignal): AbortSignal {
  return combineSignals([external, timeoutSignal(timeout)]);
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    return;
  }
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function requireText(value: string): string {
  const text = value.trim();
  if (!text) throw new Error('The AI provider returned an empty response. Try again or choose another model.');
  return text;
}

function modelFor(provider: Exclude<LlmProvider, 'novita'>, stored: string, tier: LlmTier): string {
  const looksRight =
    (provider === 'anthropic' && stored.startsWith('claude')) ||
    (provider === 'openai' && /^(gpt|o\d)/.test(stored)) ||
    (provider === 'google' && stored.startsWith('gemini'));
  const retiredGoogleModel = provider === 'google' && /^gemini-2\.0(?:-|$)/.test(stored);
  const key = tier === 'best' ? 'best' : tier;
  return looksRight && !retiredGoogleModel ? stored : PROVIDER_DEFAULTS[provider][key];
}

function usageFromOpenAi(data: any): LlmUsage | undefined {
  const usage = data?.usage;
  if (!usage) return undefined;
  return {
    promptTokens: Number(usage.prompt_tokens) || undefined,
    completionTokens: Number(usage.completion_tokens) || undefined,
    totalTokens: Number(usage.total_tokens) || undefined,
    cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens) || undefined,
  };
}

async function callAnthropic(key: string, model: string, req: LlmRequest): Promise<AdapterResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: requestSignal(req.attemptTimeoutMs ?? REQUEST_TIMEOUT_MS, req.signal),
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: 'user', content: req.prompt }],
      ...(req.temperature == null ? {} : { temperature: req.temperature }),
    }),
  });
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: requireText((data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')),
    usage: data.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
        }
      : undefined,
  };
}

async function callOpenAiCompatible(
  endpoint: string,
  key: string,
  model: string,
  req: LlmRequest,
  directOpenAi = false,
): Promise<AdapterResult> {
  const tokenLimit = req.maxTokens ?? 1024;
  const modernTokenField = directOpenAi && /^(gpt-5|o\d)/.test(model)
    ? { max_completion_tokens: tokenLimit }
    : { max_tokens: tokenLimit };
  const res = await fetch(endpoint, {
    method: 'POST',
    signal: requestSignal(req.attemptTimeoutMs ?? REQUEST_TIMEOUT_MS, req.signal),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      ...modernTokenField,
      ...(req.temperature == null || (directOpenAi && /^(gpt-5|o\d)/.test(model))
        ? {}
        : { temperature: req.temperature }),
      ...(req.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ],
    }),
  });
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    usage?: unknown;
  };
  const raw = data.choices?.[0]?.message?.content;
  const text = Array.isArray(raw) ? raw.map((part) => part.text ?? '').join('') : raw ?? '';
  return { text: requireText(text), usage: usageFromOpenAi(data) };
}

async function callOpenAI(key: string, model: string, req: LlmRequest): Promise<AdapterResult> {
  return callOpenAiCompatible('https://api.openai.com/v1/chat/completions', key, model, req, true);
}

async function callNovita(key: string, model: string, req: LlmRequest): Promise<AdapterResult> {
  return callOpenAiCompatible('https://api.novita.ai/openai/v1/chat/completions', key, model, req);
}

async function callGoogle(key: string, model: string, req: LlmRequest): Promise<AdapterResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      signal: requestSignal(req.attemptTimeoutMs ?? REQUEST_TIMEOUT_MS, req.signal),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: {
          maxOutputTokens: req.maxTokens ?? 1024,
          ...(req.temperature == null ? {} : { temperature: req.temperature }),
          ...(req.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    },
  );
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  };
  return {
    text: requireText((data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')),
    usage: data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
          totalTokens: data.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

async function httpError(res: Response): Promise<ProviderHttpError> {
  const detail = await res.text().catch(() => '');
  if (res.status === 400) return new ProviderHttpError(`The AI provider rejected this request. ${detail.slice(0, 180)}`.trim(), 400, detail);
  if (res.status === 401 || res.status === 403) return new ProviderHttpError('Invalid API key', res.status, detail);
  if (res.status === 404) return new ProviderHttpError('The selected AI model is not available.', 404, detail);
  if (res.status === 408 || res.status === 504) return new ProviderHttpError('The AI provider timed out — try again.', res.status, detail);
  if (res.status === 429) return new ProviderHttpError('Rate limited — trying another route.', 429, detail);
  if (res.status >= 500) return new ProviderHttpError('The AI provider is temporarily unavailable.', res.status, detail);
  return new ProviderHttpError(`LLM request failed (${res.status}) ${detail.slice(0, 180)}`, res.status, detail);
}

const ADAPTERS: Record<LlmProvider, Adapter> = {
  novita: callNovita,
  anthropic: callAnthropic,
  openai: callOpenAI,
  google: callGoogle,
};

function transient(error: unknown): boolean {
  if (error instanceof ProviderHttpError) return error.status === 408 || error.status === 429 || error.status >= 500;
  const name = (error as { name?: string })?.name;
  return name === 'AbortError' || name === 'TimeoutError' || error instanceof TypeError;
}

function canTryAnotherModel(error: unknown): boolean {
  return error instanceof ProviderHttpError
    ? error.status === 404 || error.status === 408 || error.status === 429 || error.status >= 500
    : transient(error);
}

function readableError(error: unknown): Error {
  const name = (error as { name?: string })?.name;
  if (name === 'AbortError') return new Error('AI request cancelled.');
  if (name === 'TimeoutError') return new Error('The AI request timed out — try again.');
  if (error instanceof TypeError) return new Error('Could not reach the AI provider. Check your connection and try again.');
  return error instanceof Error ? error : new Error('The AI request failed.');
}

async function callWithRetry(adapter: Adapter, key: string, model: string, req: LlmRequest): Promise<AdapterResult> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await adapter(key, model, req);
    } catch (error) {
      last = error;
      if (req.signal?.aborted) throw req.signal.reason ?? error;
      if (!transient(error) || attempt === 1) throw error;
      await abortableDelay(350 + Math.round(Math.random() * 250), req.signal);
    }
  }
  throw last;
}

function modelsForRequest(
  provider: LlmProvider,
  settings: Awaited<ReturnType<typeof getAiSettings>>,
  req: LlmRequest,
): { models: string[]; routeReason?: string } {
  const tier = req.tier ?? 'fast';
  if (provider === 'novita') {
    const route = routeNovitaModels({
      mode: req.routeMode ?? settings.routeMode ?? 'auto',
      tier,
      task: req.task,
      promptLength: (req.system?.length ?? 0) + req.prompt.length,
      customModels: {
        fast: settings.fastModel,
        smart: settings.smartModel,
        best: settings.bestModel,
        vision: settings.visionModel,
      },
    });
    return { models: route.models, routeReason: route.reason };
  }

  const stored = tier === 'best' ? settings.bestModel : tier === 'smart' ? settings.smartModel : settings.fastModel;
  return { models: [modelFor(provider, stored, tier)] };
}

export async function llmAvailable(): Promise<boolean> {
  const settings = await getAiSettings();
  return settings.enabled && settings.apiKey.trim().length > 0;
}

export async function llmCompleteDetailed(req: LlmRequest): Promise<LlmResult> {
  const settings = await getAiSettings();
  if (!settings.enabled || !settings.apiKey.trim()) throw new Error('No API key configured');
  const provider = (settings.provider ?? 'novita') as LlmProvider;
  const overallSignal = requestSignal(req.overallTimeoutMs ?? OVERALL_REQUEST_TIMEOUT_MS, req.signal);
  const effectiveRequest: LlmRequest = { ...req, signal: overallSignal };
  const { models, routeReason } = modelsForRequest(provider, settings, effectiveRequest);
  const startedAt = performance.now();
  let lastError: unknown;

  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    try {
      const result = await callWithRetry(ADAPTERS[provider], settings.apiKey.trim(), model, effectiveRequest);
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      return {
        text: result.text,
        provider,
        model,
        latencyMs,
        usage: result.usage,
        estimatedCostUsd: provider === 'novita' ? estimateModelCostUsd(model, result.usage) : undefined,
        routeReason,
        fallbackCount: index,
      };
    } catch (error) {
      lastError = error;
      if (effectiveRequest.signal?.aborted || !canTryAnotherModel(error) || index === models.length - 1) break;
    }
  }

  throw readableError(effectiveRequest.signal?.reason ?? lastError);
}

export async function llmComplete(req: LlmRequest): Promise<string> {
  return (await llmCompleteDetailed(req)).text;
}

export async function listProviderModels(provider: LlmProvider, apiKey: string): Promise<ProviderModel[]> {
  const key = apiKey.trim();
  if (!key) return [];
  if (provider !== 'novita' && provider !== 'openai') {
    const defaults = PROVIDER_DEFAULTS[provider];
    return [...new Set([defaults.fast, defaults.smart, defaults.best, defaults.vision])].map((id) => ({ id }));
  }

  const endpoint = provider === 'novita'
    ? 'https://api.novita.ai/openai/v1/models'
    : 'https://api.openai.com/v1/models';
  const res = await fetch(endpoint, {
    signal: requestSignal(MODEL_LIST_TIMEOUT_MS),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
  });
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as {
    data?: Array<{
      id?: string;
      title?: string;
      description?: string;
      input_token_price_per_m?: number;
      output_token_price_per_m?: number;
      context_length?: number;
    }>;
  };
  return (data.data ?? [])
    .filter((model) => Boolean(model.id))
    .map((model) => ({
      id: model.id!,
      title: model.title,
      description: model.description,
      inputTokenPricePerMillion: Number(model.input_token_price_per_m) || undefined,
      outputTokenPricePerMillion: Number(model.output_token_price_per_m) || undefined,
      contextLength: Number(model.context_length) || undefined,
    }))
    .sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
}

// Pull the first JSON value out of a model response. Handles fenced JSON and
// trailing prose by scanning for the balanced end of the first JSON value.
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ── Chrome built-in AI ──────────────────────────────────────────────────────
// Feature-detected at runtime; never assumed. Used for free on-device
// summaries when available, with BYOK as fallback.

interface BuiltinSummarizer {
  summarize(text: string, opts?: { context?: string }): Promise<string>;
  destroy?: () => void;
}

async function createBuiltinSummarizer(): Promise<BuiltinSummarizer | null> {
  try {
    const summarizer = (globalThis as any).Summarizer ?? (globalThis as any).ai?.summarizer;
    if (!summarizer) return null;
    const availability = await (summarizer.availability?.() ?? summarizer.capabilities?.().then((c: any) => c?.available));
    if (availability !== 'available' && availability !== 'readily') return null;
    const create = summarizer.create?.bind(summarizer) ?? summarizer.createTextSession?.bind(summarizer);
    if (!create) return null;
    return await create({ type: 'tldr', format: 'plain-text', length: 'short' });
  } catch {
    return null;
  }
}

export async function builtinSummarize(text: string): Promise<string | null> {
  const summarizer = await createBuiltinSummarizer();
  if (!summarizer) return null;
  try {
    const output = await summarizer.summarize(text.slice(0, 12_000));
    return output?.trim() || null;
  } catch {
    return null;
  } finally {
    summarizer.destroy?.();
  }
}

export async function testProviderKey(provider: LlmProvider, apiKey: string): Promise<boolean> {
  try {
    const defaults = PROVIDER_DEFAULTS[provider];
    await callWithRetry(ADAPTERS[provider], apiKey.trim(), defaults.fast, {
      prompt: 'Reply with the single word OK.',
      maxTokens: 12,
      tier: 'fast',
      task: 'general',
      temperature: 0,
    });
    return true;
  } catch {
    return false;
  }
}
