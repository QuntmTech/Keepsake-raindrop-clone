export type AiRouteMode = 'auto' | 'economy' | 'balanced' | 'best';
export type LlmTier = 'fast' | 'smart' | 'best';
export type LlmTask =
  | 'filing'
  | 'search'
  | 'writer'
  | 'custom-writer'
  | 'page'
  | 'library'
  | 'transcript'
  | 'general';

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
}

export interface KnownModel {
  id: string;
  label: string;
  provider: 'Novita';
  profile: 'economy' | 'balanced' | 'best' | 'vision';
  price: ModelPrice;
  context: number;
  description: string;
}

export const NOVITA_MODEL_IDS = {
  economy: 'openai/gpt-oss-20b',
  balanced: 'deepseek/deepseek-v4-flash',
  best: 'deepseek/deepseek-v4-pro',
  vision: 'qwen/qwen3-vl-235b-a22b-instruct',
} as const;

export const KNOWN_NOVITA_MODELS: KnownModel[] = [
  {
    id: NOVITA_MODEL_IDS.economy,
    label: 'GPT-OSS 20B',
    provider: 'Novita',
    profile: 'economy',
    price: { inputPerMillion: 0.04, outputPerMillion: 0.15 },
    context: 131_072,
    description: 'Lowest-cost choice for rewrites, grammar, tagging, and short summaries.',
  },
  {
    id: NOVITA_MODEL_IDS.balanced,
    label: 'DeepSeek V4 Flash',
    provider: 'Novita',
    profile: 'balanced',
    price: { inputPerMillion: 0.14, cachedInputPerMillion: 0.028, outputPerMillion: 0.28 },
    context: 1_048_576,
    description: 'Fast reasoning with a very large context window for page and library work.',
  },
  {
    id: NOVITA_MODEL_IDS.best,
    label: 'DeepSeek V4 Pro',
    provider: 'Novita',
    profile: 'best',
    price: { inputPerMillion: 1.6, cachedInputPerMillion: 0.135, outputPerMillion: 3.2 },
    context: 1_048_576,
    description: 'Escalation model for difficult research, reasoning, and high-value answers.',
  },
  {
    id: NOVITA_MODEL_IDS.vision,
    label: 'Qwen3-VL 235B Instruct',
    provider: 'Novita',
    profile: 'vision',
    price: { inputPerMillion: 0.3, outputPerMillion: 1.5 },
    context: 131_072,
    description: 'Vision-language model reserved for screenshot and document-image understanding.',
  },
];

export interface RouteRequest {
  mode: AiRouteMode;
  tier: LlmTier;
  task?: LlmTask;
  promptLength?: number;
  customModels?: Partial<Record<'fast' | 'smart' | 'best' | 'vision', string>>;
}

export interface ModelRoute {
  models: string[];
  reason: string;
  resolvedMode: Exclude<AiRouteMode, 'auto'>;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function routeNovitaModels(request: RouteRequest): ModelRoute {
  const promptLength = Math.max(0, request.promptLength ?? 0);
  const task = request.task ?? 'general';
  const custom = request.customModels ?? {};
  const economy = custom.fast || NOVITA_MODEL_IDS.economy;
  const balanced = custom.smart || NOVITA_MODEL_IDS.balanced;
  const best = custom.best || NOVITA_MODEL_IDS.best;

  let resolvedMode: Exclude<AiRouteMode, 'auto'>;
  let reason: string;

  if (request.mode !== 'auto') {
    resolvedMode = request.mode;
    reason = `Manual ${request.mode} mode`;
  } else if (request.tier === 'best') {
    resolvedMode = 'best';
    reason = 'The feature explicitly requested maximum quality';
  } else if (task === 'library' && (promptLength > 14_000 || request.tier === 'smart')) {
    resolvedMode = promptLength > 45_000 ? 'best' : 'balanced';
    reason = promptLength > 45_000 ? 'Large grounded library question' : 'Grounded library reasoning';
  } else if (task === 'page' || task === 'transcript' || task === 'custom-writer') {
    resolvedMode = promptLength > 32_000 ? 'best' : 'balanced';
    reason = promptLength > 32_000 ? 'Long complex source material' : 'Context-heavy transformation';
  } else if (request.tier === 'smart' || promptLength > 18_000) {
    resolvedMode = 'balanced';
    reason = 'The request benefits from stronger reasoning';
  } else {
    resolvedMode = 'economy';
    reason = 'Routine high-frequency task';
  }

  if (resolvedMode === 'economy') {
    return { models: unique([economy, balanced, best]), reason, resolvedMode };
  }
  if (resolvedMode === 'balanced') {
    return { models: unique([balanced, economy, best]), reason, resolvedMode };
  }
  return { models: unique([best, balanced, economy]), reason, resolvedMode };
}

export function knownNovitaModel(id: string): KnownModel | undefined {
  return KNOWN_NOVITA_MODELS.find((model) => model.id === id);
}

export function estimateModelCostUsd(
  modelId: string,
  usage?: { promptTokens?: number; completionTokens?: number; cachedTokens?: number },
): number | undefined {
  const model = knownNovitaModel(modelId);
  if (!model || !usage) return undefined;
  const prompt = Math.max(0, usage.promptTokens ?? 0);
  const cached = Math.min(prompt, Math.max(0, usage.cachedTokens ?? 0));
  const uncached = prompt - cached;
  const output = Math.max(0, usage.completionTokens ?? 0);
  const inputCost = (uncached / 1_000_000) * model.price.inputPerMillion;
  const cachedCost = (cached / 1_000_000) * (model.price.cachedInputPerMillion ?? model.price.inputPerMillion);
  const outputCost = (output / 1_000_000) * model.price.outputPerMillion;
  return inputCost + cachedCost + outputCost;
}

export function formatEstimatedCost(cost?: number): string {
  if (cost == null || !Number.isFinite(cost)) return '';
  if (cost < 0.0001) return '<$0.0001';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}
