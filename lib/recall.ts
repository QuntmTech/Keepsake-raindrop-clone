import { getSettings } from './settings';
import { semanticMatch } from './embedder';
import { canonicalUrl, db, type Save } from './save';
import { nowIso, safeDomain } from './util';

// Ambient Recall (Phase 2): the library follows the user around the web.
// ALL matching runs locally — exact/domain lookups against IndexedDB and
// cosine similarity against locally-computed vectors in the offscreen doc.
// Zero network calls; no page content ever leaves the device.

export interface RecallItem {
  id: string;
  kind: 'exact' | 'semantic';
  score?: number;
  title: string;
  url: string;
  domain: string;
  favicon?: string;
  summary?: string | null;
  createdAt: string;
}

export interface RecallResult {
  url: string;
  checkedAt: number;
  exact: RecallItem[];
  semantic: RecallItem[];
  domainCount: number; // how many saves come from this domain
  total: number; // badge number: exact + semantic
}

const SEMANTIC_THRESHOLD = 0.75;
const SEMANTIC_LIMIT = 5;

function toItem(s: Save, kind: RecallItem['kind'], score?: number): RecallItem {
  return {
    id: s.id,
    kind,
    score,
    title: s.title,
    url: s.url,
    domain: s.domain,
    favicon: s.favicon,
    summary: s.ai.summary,
    createdAt: s.timestamps.createdAt,
  };
}

export async function recallAllowed(url: string): Promise<boolean> {
  if (!/^https?:/i.test(url)) return false;
  const settings = await getSettings();
  if (!settings.recallEnabled) return false; // global kill switch / opt-in
  const domain = safeDomain(url).toLowerCase();
  return !settings.recallBlocklist.some((b) => {
    const block = b.trim().toLowerCase().replace(/^www\./, '');
    return block && (domain === block || domain.endsWith(`.${block}`));
  });
}

// The matching order from the brief: exact canonical URL → domain count →
// semantic similarity over title + meta description only (cheap, no page read).
export async function matchPage(page: { url: string; title?: string; description?: string }): Promise<RecallResult> {
  const canon = canonicalUrl(page.url);
  const domain = safeDomain(page.url);

  const exactRows = await db.saves.where('canonicalUrl').equals(canon).toArray();
  const exact = exactRows.map((s) => toItem(s, 'exact'));

  const domainCount = domain ? await db.saves.where('domain').equals(domain).count() : 0;

  let semantic: RecallItem[] = [];
  const queryText = [page.title, page.description].filter(Boolean).join('\n');
  if (queryText.trim()) {
    try {
      const matches = await semanticMatch(queryText, {
        threshold: SEMANTIC_THRESHOLD,
        limit: SEMANTIC_LIMIT,
        excludeCanonical: canon,
      });
      const rows = await db.saves.bulkGet(matches.map((m) => m.id));
      semantic = matches
        .map((m, i) => ({ m, s: rows[i] }))
        .filter((x): x is { m: { id: string; score: number }; s: Save } => Boolean(x.s))
        .map(({ m, s }) => toItem(s, 'semantic', m.score));
    } catch {
      /* model still warming up — exact/domain results are still useful */
    }
  }

  // Remember that these were surfaced (feeds future ranking ideas).
  const surfacedIds = [...exact, ...semantic].map((i) => i.id);
  if (surfacedIds.length) {
    db.saves
      .where('id')
      .anyOf(surfacedIds)
      .modify((s) => {
        s.timestamps.lastSurfacedAt = nowIso();
      })
      .catch(() => {});
  }

  return {
    url: page.url,
    checkedAt: Date.now(),
    exact,
    semantic,
    domainCount,
    total: exact.length + semantic.length,
  };
}
