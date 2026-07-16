import Dexie, { type Table } from 'dexie';
import { storage } from 'wxt/utils/storage';
import { genId, nowIso, safeDomain } from './util';
import { type Bookmark } from './types';

// ── The unified Save model ───────────────────────────────────────────────────
// Everything the user keeps — link, screenshot, recording, note — is ONE object
// type. Saves live in IndexedDB (Dexie): embeddings, extracted content, watch
// history and snapshots are too big/slow for chrome.storage and don't belong in
// the sync backend. The cloud vault (PocketBase/local backend) stays the source
// of truth for the core bookmark fields it already syncs; a Save row shares the
// same id and carries the AI-native layer on top (sidecar architecture).

export type SaveType = 'link' | 'screenshot' | 'recording' | 'note';
export type WatchMode = 'price' | 'content' | 'availability';
export type WatchFrequency = '1h' | '6h' | 'daily' | 'weekly';

export interface Save {
  id: string; // shared with the vault bookmark id when one exists
  type: SaveType;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  description?: string;
  favicon?: string;
  heroImage?: string;
  content: {
    fullText?: string | null; // Readability-extracted article text
    excerpt?: string | null;
    ocrText?: string | null; // screenshots — extraction wired in a later phase
    transcript?: string | null; // recordings — extraction wired in a later phase
  };
  ai: {
    summary?: string | null; // 2-3 sentence LLM summary
    tags: string[];
    embedding?: number[] | null; // 384-dim MiniLM vector, computed locally
    filedBy: 'ai' | 'user' | null;
    confidence?: number | null;
    processedAt?: string | null; // last successful AI pass (embed and/or file)
    queueAttempts?: number; // failed AI-queue passes — items over the cap are skipped, not retried forever
  };
  organization: {
    collectionId?: string;
    tags: string[];
    pinned: boolean;
    homeOnly?: boolean; // Home launcher tile — excluded from dedupe/recall/auto-filing
    sortOrder?: number;
  };
  monitoring: {
    enabled: boolean;
    mode: WatchMode | null;
    selector?: string; // user-taught CSS selector (price / region / stock)
    lastValue?: string; // last price or content hash
    frequency: WatchFrequency;
    alertRule?: { type: 'below' | 'any-change'; value?: number };
    nextCheckAt?: number; // epoch ms — indexed so the scheduler can query due watches
    lastCheckedAt?: number;
    failCount?: number; // consecutive fetch failures (backoff + dead-link detection)
    jsRendered?: boolean; // plain fetch can't see the value → "checks on visit"
    history: Array<{ ts: number; value: string; note?: string }>;
  };
  archive: {
    snapshotRef?: string; // blobs-table key of our own MHTML/PNG snapshot
    status: 'alive' | 'dead' | 'healed';
    waybackUrl?: string;
  };
  timestamps: {
    createdAt: string;
    updatedAt: string;
    lastVisitedAt?: string;
    lastSurfacedAt?: string; // last time Ambient Recall surfaced this save
  };
}

export interface SaveBlob {
  id: string; // `${saveId}:${kind}`
  saveId: string;
  kind: 'snapshot' | 'screenshot' | 'recording';
  mime: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

interface MetaRow {
  key: string;
  value: unknown;
}

// A fresh capture parked for the Capture Studio (editor) tab. The blob lives
// here so the studio can be a plain page load — no message-size limits, and
// the capture survives even if the tab never opens. Rows are pruned after a
// week so recordings don't pile up.
export interface StudioItem {
  id: string;
  kind: 'screenshot' | 'recording';
  blob: Blob;
  pageUrl?: string;
  pageTitle?: string;
  filename: string;
  durationMs?: number;
  saveId?: string; // library Save this capture was auto-filed into
  createdAt: string;
}

// ── Canonical URLs ───────────────────────────────────────────────────────────
// Dedupe + exact-match recall both key on this: lowercase host minus www,
// path minus trailing slash, tracking params and fragments stripped.
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|msclkid|mc_eid|ref_?$|igshid)/i;

export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    const params = [...u.searchParams.keys()];
    for (const k of params) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '');
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

// ── Dexie database ───────────────────────────────────────────────────────────
class KeepsakeDB extends Dexie {
  saves!: Table<Save, string>;
  blobs!: Table<SaveBlob, string>;
  meta!: Table<MetaRow, string>;
  studio!: Table<StudioItem, string>;

  constructor() {
    super('keepsake');
    this.version(1).stores({
      saves: 'id, canonicalUrl, domain, type, monitoring.enabled, monitoring.nextCheckAt, ai.processedAt',
      blobs: 'id, saveId, kind',
      meta: 'key',
    });
    // v2: parked captures for the Capture Studio editor tab.
    this.version(2).stores({
      studio: 'id, createdAt',
    });
  }
}

export const db = new KeepsakeDB();

// ── CRUD helpers ─────────────────────────────────────────────────────────────

export function emptySave(partial: Partial<Save> & { url: string; title: string }): Save {
  const now = nowIso();
  return {
    id: genId(),
    type: 'link',
    canonicalUrl: canonicalUrl(partial.url),
    domain: safeDomain(partial.url),
    description: undefined,
    favicon: undefined,
    heroImage: undefined,
    content: { fullText: null, excerpt: null, ocrText: null, transcript: null },
    ai: { summary: null, tags: [], embedding: null, filedBy: null, confidence: null, processedAt: null },
    organization: { tags: [], pinned: false },
    monitoring: { enabled: false, mode: null, frequency: 'daily', history: [] },
    archive: { status: 'alive' },
    timestamps: { createdAt: now, updatedAt: now },
    ...partial,
  };
}

export async function getSave(id: string): Promise<Save | undefined> {
  return db.saves.get(id);
}

export async function putSave(save: Save): Promise<void> {
  save.timestamps.updatedAt = nowIso();
  await db.saves.put(save);
}

export async function patchSave(id: string, patch: (s: Save) => void): Promise<Save | undefined> {
  return db.transaction('rw', db.saves, async () => {
    const s = await db.saves.get(id);
    if (!s) return undefined;
    patch(s);
    s.timestamps.updatedAt = nowIso();
    await db.saves.put(s);
    return s;
  });
}

export async function deleteSave(id: string): Promise<void> {
  await db.transaction('rw', db.saves, db.blobs, async () => {
    await db.saves.delete(id);
    await db.blobs.where('saveId').equals(id).delete();
  });
}

// Home launcher tiles are not library content: dedupe, recall, and imports
// must not treat them as "already saved". Pass homeOnly:'include' only where
// tiles genuinely count (e.g. the catalog's own re-add check).
export async function findSaveByUrl(
  url: string,
  opts: { homeOnly?: 'include' } = {},
): Promise<Save | undefined> {
  const rows = await db.saves.where('canonicalUrl').equals(canonicalUrl(url)).toArray();
  if (opts.homeOnly === 'include') return rows[0];
  return rows.find((s) => !s.organization.homeOnly);
}

export async function putBlob(saveId: string, kind: SaveBlob['kind'], blob: Blob): Promise<string> {
  const id = `${saveId}:${kind}`;
  await db.blobs.put({ id, saveId, kind, mime: blob.type, size: blob.size, blob, createdAt: nowIso() });
  return id;
}

// ── Capture Studio handoff ───────────────────────────────────────────────────

export async function stashStudioItem(item: Omit<StudioItem, 'id' | 'createdAt'>): Promise<string> {
  const id = genId();
  await db.studio.put({ ...item, id, createdAt: nowIso() });
  return id;
}

export async function getStudioItem(id: string): Promise<StudioItem | undefined> {
  return db.studio.get(id);
}

export async function updateStudioItem(id: string, patch: Partial<StudioItem>): Promise<void> {
  await db.studio.update(id, patch);
}

// Captures parked for the studio are working copies — drop anything older
// than a week (recordings are large; this table must not grow unbounded).
export async function pruneStudioItems(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  await db.studio.where('createdAt').below(cutoff).delete().catch(() => {});
}


// Mirror a vault bookmark into its sidecar Save row. Never loses AI data:
// existing content/ai/monitoring/archive fields are preserved on update.
export function saveFromBookmark(b: Bookmark, existing?: Save): Save {
  const type: SaveType = existing?.type && existing.type !== 'link' ? existing.type : 'link';
  const base = existing ?? emptySave({ id: b.id, url: b.url, title: b.title });
  return {
    ...base,
    id: b.id,
    type,
    url: b.url,
    canonicalUrl: canonicalUrl(b.url),
    domain: b.domain || safeDomain(b.url),
    title: b.title,
    description: b.description,
    favicon: b.favicon,
    heroImage: b.cover,
    content: {
      ...base.content,
      fullText: b.content ?? base.content.fullText ?? null,
    },
    ai: {
      ...base.ai,
      summary: base.ai.summary ?? b.summary ?? null,
      tags: base.ai.tags.length ? base.ai.tags : b.aiTags ?? [],
    },
    organization: {
      collectionId: b.collection,
      tags: b.tags ?? [],
      pinned: Boolean(b.pinned),
      homeOnly: Boolean(b.homeOnly),
      sortOrder: b.sort,
    },
    timestamps: {
      ...base.timestamps,
      // A FRESH row must take the bookmark's real save date — emptySave() stamps
      // createdAt "now" (always truthy), so `base... || b.created` made every
      // mirrored row look saved-today ("You saved this today" on years-old
      // bookmarks, wrong dates in Ambient Recall). Existing rows keep their own.
      createdAt: existing ? base.timestamps.createdAt : b.created || base.timestamps.createdAt,
      lastVisitedAt: b.lastVisited ?? base.timestamps.lastVisitedAt,
    },
  };
}

// Sidecar upsert used by the saveBookmark facade. Runs the read-merge-write
// inside one transaction so it can never interleave with patchSave and revert
// freshly written ai fields. A failure must never break the user's save.
export async function upsertSidecar(b: Bookmark): Promise<void> {
  try {
    await db.transaction('rw', db.saves, async () => {
      const existing = await db.saves.get(b.id);
      await db.saves.put(saveFromBookmark(b, existing));
    });
  } catch {
    /* reconciled by the startup sweep */
  }
}

// ── Migration (v8.2): vault → Save rows ─────────────────────────────────────
// Idempotent: keyed by bookmark id, safe to run on every startup. Reversible:
// before the first run, the legacy chrome.storage stores are copied under
// versioned backup keys and never touched again (the vault itself is not
// modified by this migration at all — Saves are additive).
const MIGRATED_KEY = 'migrated_saves_v820';
const backupDone = storage.defineItem<boolean>('local:backup_v820_done', { fallback: false });

export async function migrateToSaves(
  // Must page through the WHOLE vault and report completeness honestly (see
  // fetchAllBookmarks in lib/bookmarks.ts) — the orphan-deletion pass below is
  // gated on `complete`, never on a row-count heuristic.
  fetchAll: () => Promise<{ items: Bookmark[]; complete: boolean }>,
  // Startup sweeps mark newly mirrored rows as user-filed (pre-existing vault
  // organization is sacred); the import escape hatch passes false so its rows
  // flow through the AI queue.
  opts: { respectExisting?: boolean } = {},
): Promise<number> {
  const respectExisting = opts.respectExisting ?? true;
  // 1. One-time backup of the legacy local stores (local-mode data + caches).
  if (!(await backupDone.getValue())) {
    try {
      const legacy = await browser.storage.local.get(['bookmarks', 'collections', 'highlights']);
      await browser.storage.local.set({
        backup_v820: { ts: nowIso(), data: legacy },
      });
      await backupDone.setValue(true);
    } catch {
      /* backup is best-effort; migration below is additive anyway */
    }
  }

  // 2. Reconcile the sidecar with the vault: create missing rows, refresh the
  // mirrored core/organization fields of existing ones (edits made on another
  // device arrive here), and drop link rows whose bookmark no longer exists.
  let created = 0;
  try {
    const { items: bookmarks, complete } = await fetchAll();
    const ids = bookmarks.map((b) => b.id);
    const existing = await db.saves.bulkGet(ids);
    const rows: Save[] = [];
    bookmarks.forEach((b, i) => {
      const row = existing[i];
      if (!row) {
        const fresh = saveFromBookmark(b);
        if (respectExisting) fresh.ai.filedBy = 'user';
        rows.push(fresh);
        created++;
      } else {
        rows.push(saveFromBookmark(b, row)); // refresh mirror, keep ai/monitoring
      }
    });
    if (rows.length) await db.saves.bulkPut(rows);

    // Deletions: ONLY when the fetch PROVABLY covered the whole vault. The old
    // `length < 2000` heuristic was catastrophically wrong on hosted vaults
    // bigger than the PocketBase server page clamp: a single clamped page
    // "proved" completeness, and every save beyond it — embeddings, AI
    // summaries, watch configs, snapshot blobs — was bulk-deleted as an orphan
    // on every startup.
    if (complete) {
      const alive = new Set(ids);
      const orphans = await db.saves
        .filter((s) => s.type === 'link' && !alive.has(s.id))
        .primaryKeys();
      if (orphans.length) {
        await db.saves.bulkDelete(orphans);
        await db.blobs.where('saveId').anyOf(orphans).delete();
      }
    }
    await db.meta.put({ key: MIGRATED_KEY, value: nowIso() });
  } catch {
    /* vault unreachable (offline/logged out) — next startup retries */
  }
  return created;
}
