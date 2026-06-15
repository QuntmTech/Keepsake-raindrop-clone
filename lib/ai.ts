import { storage } from 'wxt/utils/storage';
import { type AiSettings, DEFAULT_AI_SETTINGS, type Bookmark } from './types';

// AI layer for Keepsake. Calls the Anthropic Messages API directly from the
// extension (browser context) using the official direct-browser-access opt-in.
// The key lives in chrome.storage.local — never synced, never committed.
//
// Models (resolved from settings):
//   fast  -> claude-haiku-4-5  : auto-tagging, summaries, collection hints (cheap + quick)
//   smart -> claude-opus-4-8   : "ask your library" Q&A over saved content

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

const aiStore = storage.defineItem<AiSettings>('local:ai_settings', {
  fallback: DEFAULT_AI_SETTINGS,
});

export async function getAiSettings(): Promise<AiSettings> {
  // Merge so new fields added in updates get sane defaults.
  return { ...DEFAULT_AI_SETTINGS, ...(await aiStore.getValue()) };
}

export async function setAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const next = { ...(await getAiSettings()), ...patch };
  await aiStore.setValue(next);
  return next;
}

export async function aiAvailable(): Promise<boolean> {
  const s = await getAiSettings();
  return s.enabled && s.apiKey.trim().length > 0;
}

export function watchAiSettings(cb: (s: AiSettings) => void): () => void {
  return aiStore.watch((v) => cb({ ...DEFAULT_AI_SETTINGS, ...(v ?? DEFAULT_AI_SETTINGS) }));
}

interface AnthropicTextBlock { type: string; text?: string }

// Low-level Messages API call. Returns the concatenated text output.
async function callClaude(opts: {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  const s = await getAiSettings();
  if (!s.apiKey) throw new Error('No API key set');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': s.apiKey,
      'anthropic-version': API_VERSION,
      // Required so the API serves CORS headers to browser/extension contexts.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: opts.prompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('Invalid API key');
    if (res.status === 429) throw new Error('Rate limited — try again shortly');
    throw new Error(`AI request failed (${res.status}) ${detail.slice(0, 140)}`);
  }

  const data = (await res.json()) as { content?: AnthropicTextBlock[]; stop_reason?: string };
  if (data.stop_reason === 'refusal') throw new Error('The model declined this request');
  return (data.content ?? [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('')
    .trim();
}

// Pull the first JSON value out of a model response (handles ```json fences).
function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(raw.slice(start)) as T;
  } catch {
    return null;
  }
}

export interface PageContext {
  title: string;
  url: string;
  description?: string;
  text?: string; // optional extracted page text
}

// Suggest 3–6 lowercase tags for a page.
export async function suggestTags(ctx: PageContext, existingTags: string[] = []): Promise<string[]> {
  const s = await getAiSettings();
  const known = existingTags.slice(0, 60).join(', ');
  const out = await callClaude({
    model: s.fastModel,
    maxTokens: 200,
    system:
      'You tag bookmarks for a personal library. Reply with ONLY a JSON array of 3-6 short, ' +
      'lowercase, single- or two-word topical tags. Prefer reusing the user\'s existing tags when they fit.',
    prompt:
      `Existing tags: [${known}]\n\n` +
      `Title: ${ctx.title}\nURL: ${ctx.url}\n` +
      (ctx.description ? `Description: ${ctx.description}\n` : '') +
      (ctx.text ? `\nExcerpt:\n${ctx.text.slice(0, 2000)}\n` : '') +
      '\nReturn the JSON array only.',
  });
  const tags = extractJson<string[]>(out) ?? [];
  return [...new Set(tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean))].slice(0, 6);
}

// One- or two-sentence TL;DR of a page.
export async function summarize(ctx: PageContext): Promise<string> {
  const s = await getAiSettings();
  return callClaude({
    model: s.fastModel,
    maxTokens: 220,
    system:
      'Summarize the web page in 1-2 plain sentences (max ~45 words). No preamble, no "This page". ' +
      'Write the gist directly so the user remembers why they saved it.',
    prompt:
      `Title: ${ctx.title}\nURL: ${ctx.url}\n` +
      (ctx.description ? `Description: ${ctx.description}\n` : '') +
      (ctx.text ? `\nContent:\n${ctx.text.slice(0, 4000)}` : ''),
  });
}

// Pick the best-fitting existing collection (or null for none).
export async function suggestCollection(
  ctx: PageContext,
  collections: { id: string; name: string }[],
): Promise<string | null> {
  if (collections.length === 0) return null;
  const s = await getAiSettings();
  const list = collections.map((c) => `${c.id}: ${c.name}`).join('\n');
  const out = await callClaude({
    model: s.fastModel,
    maxTokens: 60,
    system:
      'Choose the single best-fitting collection for a bookmark. Reply with ONLY the collection id, ' +
      'or the word "none" if nothing fits well.',
    prompt: `Collections:\n${list}\n\nTitle: ${ctx.title}\nURL: ${ctx.url}\n${ctx.description ?? ''}`,
  });
  const id = out.replace(/[^a-zA-Z0-9]/g, '').trim();
  if (!id || /^none$/i.test(out.trim())) return null;
  return collections.find((c) => c.id === id) ? id : null;
}

// Semantic search: rank the user's bookmarks by meaning for a query, returning
// the matching bookmarks best-first. Uses the fast model over a compact catalog.
export async function semanticFind(query: string, corpus: Bookmark[]): Promise<Bookmark[]> {
  const s = await getAiSettings();
  const pool = corpus.slice(0, 200);
  const catalog = pool
    .map((b, i) => {
      const meta = [b.domain, ...(b.tags ?? [])].filter(Boolean).join(' · ');
      const blurb = b.summary || b.description || '';
      return `[${i}] ${b.title}${meta ? ` (${meta})` : ''}${blurb ? ` — ${blurb.slice(0, 140)}` : ''}`;
    })
    .join('\n');
  const out = await callClaude({
    model: s.fastModel,
    maxTokens: 400,
    system:
      'You search a personal bookmark library by meaning. Given a query and a numbered catalog, ' +
      'return ONLY a JSON array of the matching catalog indices, most relevant first (max 30). ' +
      'Match intent/topic, not just exact words. Return [] if nothing fits.',
    prompt: `Query: ${query}\n\nCatalog:\n${catalog}`,
  });
  const idx = extractJson<number[]>(out) ?? [];
  return idx.map((i) => pool[i]).filter((b): b is Bookmark => Boolean(b));
}

export interface LibraryAnswer {
  answer: string;
  sources: Bookmark[];
}

// "Ask your library": answer a natural-language question grounded in the user's
// own bookmarks. We pass a compact catalog and let the smart model cite by index.
export async function askLibrary(question: string, corpus: Bookmark[]): Promise<LibraryAnswer> {
  const s = await getAiSettings();
  const pool = corpus.slice(0, 120);
  const catalog = pool
    .map((b, i) => {
      const meta = [b.domain, ...(b.tags ?? [])].filter(Boolean).join(' · ');
      const blurb = b.summary || b.description || '';
      return `[${i}] ${b.title}${meta ? ` (${meta})` : ''}${blurb ? `\n    ${blurb.slice(0, 180)}` : ''}`;
    })
    .join('\n');

  const out = await callClaude({
    model: s.smartModel,
    maxTokens: 1024,
    system:
      'You are the user\'s personal librarian. Answer using ONLY the catalog of their saved bookmarks. ' +
      'Be concise and helpful. Cite the bookmarks you used by their [index]. ' +
      'Reply as JSON: {"answer": string, "sources": number[]}. ' +
      'If nothing in the catalog is relevant, say so honestly in the answer and return an empty sources array.',
    prompt: `Catalog:\n${catalog}\n\nQuestion: ${question}`,
  });

  const parsed = extractJson<{ answer: string; sources: number[] }>(out);
  if (!parsed) return { answer: out || 'No answer.', sources: [] };
  const sources = (parsed.sources ?? [])
    .map((i) => pool[i])
    .filter((b): b is Bookmark => Boolean(b));
  return { answer: parsed.answer ?? out, sources };
}

// Validate a key by issuing a tiny request.
export async function testApiKey(apiKey: string, model: string): Promise<boolean> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });
  return res.ok;
}
