import { getAiSettings } from './ai';
import { type LlmProvider } from './types';

// Provider-agnostic LLM client (BYOK). One entry point — llmComplete() — with
// adapters for Anthropic, OpenAI and Google. The key lives in
// chrome.storage.local, is never synced, and is only ever sent to the
// user-chosen provider. Chrome's built-in on-device AI (Summarizer API) is
// probed at runtime and preferred for summaries when present: free + private.

export interface LlmRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  tier?: 'fast' | 'smart'; // fast = tagging/filing (default); smart = ask-your-library
}

// Sensible default models per provider (used when the stored model id belongs
// to a different provider than the one selected).
export const PROVIDER_DEFAULTS: Record<LlmProvider, { fast: string; label: string; keyHint: string }> = {
  anthropic: { fast: 'claude-haiku-4-5', label: 'Anthropic (Claude)', keyHint: 'sk-ant-…' },
  openai: { fast: 'gpt-4o-mini', label: 'OpenAI (GPT)', keyHint: 'sk-…' },
  google: { fast: 'gemini-2.0-flash', label: 'Google (Gemini)', keyHint: 'AIza…' },
};

function modelFor(provider: LlmProvider, stored: string): string {
  // A Claude model id configured while on the OpenAI provider (etc.) would 404.
  const looksRight =
    (provider === 'anthropic' && stored.startsWith('claude')) ||
    (provider === 'openai' && /^(gpt|o\d)/.test(stored)) ||
    (provider === 'google' && stored.startsWith('gemini'));
  return looksRight ? stored : PROVIDER_DEFAULTS[provider].fast;
}

async function callAnthropic(key: string, model: string, req: LlmRequest): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
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
    }),
  });
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
}

async function callOpenAI(key: string, model: string, req: LlmRequest): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 1024,
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        { role: 'user', content: req.prompt },
      ],
    }),
  });
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

async function callGoogle(key: string, model: string, req: LlmRequest): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: { maxOutputTokens: req.maxTokens ?? 1024 },
      }),
    },
  );
  if (!res.ok) throw await httpError(res);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
}

async function httpError(res: Response): Promise<Error> {
  const detail = await res.text().catch(() => '');
  if (res.status === 401 || res.status === 403) return new Error('Invalid API key');
  if (res.status === 429) return new Error('Rate limited — try again shortly');
  return new Error(`LLM request failed (${res.status}) ${detail.slice(0, 140)}`);
}

const ADAPTERS: Record<LlmProvider, (key: string, model: string, req: LlmRequest) => Promise<string>> = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  google: callGoogle,
};

export async function llmAvailable(): Promise<boolean> {
  const s = await getAiSettings();
  return s.enabled && s.apiKey.trim().length > 0;
}

export async function llmComplete(req: LlmRequest): Promise<string> {
  const s = await getAiSettings();
  if (!s.enabled || !s.apiKey.trim()) throw new Error('No API key configured');
  const provider = (s.provider ?? 'anthropic') as LlmProvider;
  const stored = req.tier === 'smart' ? s.smartModel : s.fastModel;
  return ADAPTERS[provider](s.apiKey.trim(), modelFor(provider, stored), req);
}

// Pull the first JSON value out of a model response. Handles ```json fences
// AND trailing prose after the JSON ("{"a":1} Hope this helps!") by scanning
// for the balanced end of the first JSON value instead of parsing to EOF.
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

// ── Chrome built-in AI (Gemini Nano) ────────────────────────────────────────
// Feature-detected at runtime; never assumed. Used for free on-device
// summaries when available, with BYOK as fallback.

interface BuiltinSummarizer {
  summarize(text: string, opts?: { context?: string }): Promise<string>;
  destroy?: () => void;
}

async function createBuiltinSummarizer(): Promise<BuiltinSummarizer | null> {
  try {
    const S = (globalThis as any).Summarizer ?? (globalThis as any).ai?.summarizer;
    if (!S) return null;
    const availability = await (S.availability?.() ?? S.capabilities?.().then((c: any) => c?.available));
    if (availability !== 'available' && availability !== 'readily') return null;
    const create = S.create?.bind(S) ?? S.createTextSession?.bind(S);
    if (!create) return null;
    return await create({ type: 'tldr', format: 'plain-text', length: 'short' });
  } catch {
    return null;
  }
}

export async function builtinSummarize(text: string): Promise<string | null> {
  const s = await createBuiltinSummarizer();
  if (!s) return null;
  try {
    const out = await s.summarize(text.slice(0, 12_000));
    return out?.trim() || null;
  } catch {
    return null;
  } finally {
    s.destroy?.();
  }
}

// Cheap validation call used by Settings → "Test key".
export async function testProviderKey(provider: LlmProvider, apiKey: string): Promise<boolean> {
  try {
    await ADAPTERS[provider](apiKey.trim(), PROVIDER_DEFAULTS[provider].fast, {
      prompt: 'ping',
      maxTokens: 8,
    });
    return true;
  } catch {
    return false;
  }
}
