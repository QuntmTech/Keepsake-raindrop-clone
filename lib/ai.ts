import { storage } from 'wxt/utils/storage';
import { extractJson, llmComplete } from './llm';
import { type AiSettings, DEFAULT_AI_SETTINGS, type Bookmark } from './types';

// AI feature layer for Keepsake (tag/summary suggestions, semantic find,
// ask-your-library). All model calls route through the provider-agnostic
// client in lib/llm.ts, so they honor whichever provider (Anthropic/OpenAI/
// Google) the user configured. The key lives in chrome.storage.local —
// never synced, never committed.

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

// Thin shim over the provider-agnostic client: callers pick a tier, the
// user's configured provider + models do the rest.
async function callModel(opts: {
  tier: 'fast' | 'smart';
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  return llmComplete(opts);
}

export interface PageContext {
  title: string;
  url: string;
  description?: string;
  text?: string; // optional extracted page text
}

// Suggest 3–6 lowercase tags for a page.
export async function suggestTags(ctx: PageContext, existingTags: string[] = []): Promise<string[]> {
  const known = existingTags.slice(0, 60).join(', ');
  const out = await callModel({
    tier: 'fast',
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
  return callModel({
    tier: 'fast',
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

// Semantic search: rank the user's bookmarks by meaning for a query, returning
// the matching bookmarks best-first. Uses the fast model over a compact catalog.
export async function semanticFind(query: string, corpus: Bookmark[]): Promise<Bookmark[]> {
  const pool = corpus.slice(0, 200);
  const catalog = pool
    .map((b, i) => {
      const meta = [b.domain, ...(b.tags ?? [])].filter(Boolean).join(' · ');
      const blurb = b.summary || b.description || '';
      return `[${i}] ${b.title}${meta ? ` (${meta})` : ''}${blurb ? ` — ${blurb.slice(0, 140)}` : ''}`;
    })
    .join('\n');
  const out = await callModel({
    tier: 'fast',
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
  const pool = corpus.slice(0, 120);
  const catalog = pool
    .map((b, i) => {
      const meta = [b.domain, ...(b.tags ?? [])].filter(Boolean).join(' · ');
      const blurb = b.summary || b.description || '';
      return `[${i}] ${b.title}${meta ? ` (${meta})` : ''}${blurb ? `\n    ${blurb.slice(0, 180)}` : ''}`;
    })
    .join('\n');

  const out = await callModel({
    tier: 'smart',
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
