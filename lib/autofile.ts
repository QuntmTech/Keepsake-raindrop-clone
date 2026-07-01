import { getAiSettings } from './ai';
import { createCollection, listCollections, updateBookmark } from './bookmarks';
import { embedTexts } from './embedder';
import { builtinSummarize, extractJson, llmAvailable, llmComplete } from './llm';
import { extractPageMeta, type PageMeta } from './metadata';
import { db, getSave, patchSave, putBlob, findSaveByUrl, type Save } from './save';
import { nowIso } from './util';

// Zero-organization auto-filing (Phase 1). Runs in the background worker.
// The save itself is INSTANT and never waits on any of this — this pipeline
// enriches the record afterwards: extract → embed (local) → LLM files it.
// No key and no built-in AI? The save still works: it goes to Inbox tagged
// "unprocessed" and the batch queue upgrades it when a key appears.

export const INBOX_NAME = 'Inbox';
const CONFIDENCE_THRESHOLD = 0.7;

export interface FiledResult {
  saveId: string;
  status: 'filed' | 'inbox' | 'kept' | 'unprocessed';
  collectionId?: string;
  collectionName?: string;
  tags: string[];
  summary?: string;
  confidence?: number;
}

interface FilingDecision {
  collection: string | { new: string };
  tags: string[];
  summary: string;
  confidence: number;
}

// The system collection that catches unfiled + low-confidence saves.
export async function ensureInbox(): Promise<{ id: string; name: string }> {
  const cols = await listCollections();
  const found = cols.find((c) => c.name.toLowerCase() === INBOX_NAME.toLowerCase());
  if (found) return { id: found.id, name: found.name };
  const created = await createCollection({ name: INBOX_NAME, color: '#94a3b8', icon: '📥' });
  return { id: created.id, name: created.name };
}

// Duplicate check used by save entry points BEFORE creating a new record.
export async function findDuplicate(url: string): Promise<Save | undefined> {
  return findSaveByUrl(url);
}

export function agoLabel(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} month${days >= 60 ? 's' : ''} ago`;
  return `${Math.round(days / 365)} year${days >= 730 ? 's' : ''} ago`;
}

// Extract the page's full text via the injected extractor (activeTab/scripting).
async function extractContent(tabId: number): Promise<PageMeta | null> {
  try {
    const [res] = await browser.scripting.executeScript({ target: { tabId }, func: extractPageMeta });
    return (res?.result as PageMeta) ?? null;
  } catch {
    return null; // protected pages
  }
}

// Full-fidelity MHTML snapshot — only when the user granted the optional
// pageCapture permission (Settings → Archive copies).
async function snapshotTab(tabId: number, saveId: string): Promise<void> {
  try {
    const granted = await browser.permissions.contains({ permissions: ['pageCapture'] });
    if (!granted || !browser.pageCapture) return;
    const blob: Blob = await new Promise((resolve, reject) =>
      browser.pageCapture.saveAsMHTML({ tabId }, (b?: Blob) =>
        b ? resolve(b) : reject(new Error(browser.runtime.lastError?.message || 'no blob')),
      ),
    );
    const ref = await putBlob(saveId, 'snapshot', blob);
    await patchSave(saveId, (s) => {
      s.archive.snapshotRef = ref;
    });
  } catch {
    /* snapshots are best-effort */
  }
}

// Compact filing context: every collection with up to 3 sample titles, so the
// model files like the user does, not like a generic taxonomy.
async function collectionContext(): Promise<string> {
  const cols = await listCollections();
  const saves = await db.saves.toArray();
  const byCol = new Map<string, string[]>();
  for (const s of saves) {
    const c = s.organization.collectionId;
    if (!c) continue;
    const list = byCol.get(c) ?? [];
    if (list.length < 3) list.push(s.title.slice(0, 60));
    byCol.set(c, list);
  }
  return cols
    .filter((c) => c.name.toLowerCase() !== INBOX_NAME.toLowerCase())
    .map((c) => {
      const samples = byCol.get(c.id) ?? [];
      return `- id:${c.id} "${c.name}"${samples.length ? ` (e.g. ${samples.map((t) => `"${t}"`).join(', ')})` : ''}`;
    })
    .join('\n');
}

async function decideFiling(save: Save): Promise<FilingDecision | null> {
  const context = await collectionContext();
  const out = await llmComplete({
    maxTokens: 400,
    system:
      'You file bookmarks into a personal library with zero user effort. ' +
      'Reply with ONLY strict JSON: {"collection": "<existing id>" | {"new": "<short name>"}, ' +
      '"tags": [3-6 short lowercase topical tags], "summary": "<2-3 sentences, max 50 words>", ' +
      '"confidence": <0-1>}. Prefer an existing collection when it fits; propose {"new": ...} only ' +
      'for a clearly distinct recurring topic. confidence reflects how sure you are about the ' +
      'collection choice specifically.',
    prompt:
      `Existing collections:\n${context || '(none yet)'}\n\n` +
      `Page to file:\nTitle: ${save.title}\nURL: ${save.url}\n` +
      (save.description ? `Description: ${save.description}\n` : '') +
      (save.content.fullText ? `\nContent excerpt:\n${save.content.fullText.slice(0, 2000)}\n` : ''),
  });
  const parsed = extractJson<FilingDecision>(out);
  if (!parsed || !Array.isArray(parsed.tags)) return null;
  parsed.tags = [...new Set(parsed.tags.map((t) => String(t).toLowerCase().trim()).filter(Boolean))].slice(0, 6);
  parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  return parsed;
}

// The main pipeline. Never throws — every failure degrades to a queued state.
export async function autofileSave(saveId: string, opts: { tabId?: number } = {}): Promise<FiledResult> {
  const fallback: FiledResult = { saveId, status: 'unprocessed', tags: [] };
  const save = await getSave(saveId);
  if (!save || save.type !== 'link') return fallback;
  const ai = await getAiSettings();

  // 1. Content extraction (needs a live tab; imports/queue runs skip this).
  if (opts.tabId != null) {
    const meta = await extractContent(opts.tabId);
    if (meta?.text) {
      await patchSave(saveId, (s) => {
        s.content.fullText = meta.text ?? s.content.fullText;
        s.content.excerpt = (meta.description || meta.text?.slice(0, 300)) ?? s.content.excerpt;
      });
      save.content.fullText = meta.text;
      save.content.excerpt = meta.description || meta.text.slice(0, 300);
    }
    snapshotTab(opts.tabId, saveId); // fire-and-forget
  }

  // 2. Local embedding — always attempted, free, powers recall + dedupe.
  try {
    const text = [save.title, save.content.excerpt ?? save.description ?? '', (save.content.fullText ?? '').slice(0, 2000)]
      .filter(Boolean)
      .join('\n');
    const [vec] = await embedTexts([text || save.url]);
    if (vec) {
      await patchSave(saveId, (s) => {
        s.ai.embedding = vec;
        s.ai.processedAt = nowIso();
      });
    }
  } catch {
    /* model still downloading / offscreen busy — queue retries */
  }

  // Respect a collection the user picked explicitly (SaveForm dropdown etc.).
  const userFiled = Boolean(save.organization.collectionId) && save.ai.filedBy !== 'ai';

  // 3. LLM pass: summary + tags + filing decision.
  if (ai.enabled && ai.autoFile && (await llmAvailable())) {
    try {
      const decision = await decideFiling(save);
      if (!decision) throw new Error('unparseable filing decision');

      let collectionId: string | undefined;
      let collectionName: string | undefined;
      let status: FiledResult['status'];
      if (userFiled) {
        status = 'kept';
      } else if (decision.confidence >= CONFIDENCE_THRESHOLD) {
        if (typeof decision.collection === 'object' && decision.collection?.new) {
          const created = await createCollection({ name: decision.collection.new.slice(0, 40) });
          collectionId = created.id;
          collectionName = created.name;
        } else if (typeof decision.collection === 'string') {
          const cols = await listCollections();
          const hit = cols.find((c) => c.id === decision.collection);
          collectionId = hit?.id;
          collectionName = hit?.name;
        }
        status = collectionId ? 'filed' : 'inbox';
      } else {
        status = 'inbox';
      }
      if (status === 'inbox') {
        const inbox = await ensureInbox();
        collectionId = inbox.id;
        collectionName = inbox.name;
      }

      // Built-in on-device AI is preferred for the summary when present (free).
      const summary =
        (await builtinSummarize(save.content.fullText ?? `${save.title}. ${save.description ?? ''}`)) ||
        decision.summary;

      await updateBookmark(saveId, {
        ...(status === 'kept' ? {} : { collection: collectionId }),
        aiTags: decision.tags,
        summary,
      }).catch(() => {});
      await patchSave(saveId, (s) => {
        s.ai.summary = summary;
        s.ai.tags = decision.tags;
        s.ai.filedBy = status === 'kept' ? 'user' : 'ai';
        s.ai.confidence = decision.confidence;
        s.ai.processedAt = nowIso();
        if (status !== 'kept') s.organization.collectionId = collectionId;
      });
      return { saveId, status, collectionId, collectionName, tags: decision.tags, summary, confidence: decision.confidence };
    } catch {
      /* fall through to unprocessed */
    }
  }

  // 4. Keyless / offline degradation: Inbox + "unprocessed", queue retries.
  if (!userFiled) {
    try {
      const inbox = await ensureInbox();
      await updateBookmark(saveId, { collection: inbox.id }).catch(() => {});
      await patchSave(saveId, (s) => {
        s.organization.collectionId = inbox.id;
        if (!s.ai.tags.includes('unprocessed')) s.ai.tags = [...s.ai.tags, 'unprocessed'];
      });
      return { saveId, status: 'inbox', collectionId: inbox.id, collectionName: inbox.name, tags: ['unprocessed'] };
    } catch {
      /* backend offline — sidecar row alone is fine, queue reconciles */
    }
  }
  return fallback;
}

// Undo from the "Filed: …" toast/notification → move to Inbox, mark as
// user-filed so the queue never re-files it.
export async function undoFiling(saveId: string): Promise<void> {
  const inbox = await ensureInbox();
  await updateBookmark(saveId, { collection: inbox.id }).catch(() => {});
  await patchSave(saveId, (s) => {
    s.organization.collectionId = inbox.id;
    s.ai.filedBy = 'user';
  });
}
