import { type Bookmark } from './types';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'did', 'do', 'does', 'for', 'from',
  'had', 'has', 'have', 'how', 'i', 'in', 'into', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you',
  'your', 'find', 'show', 'tell', 'saved', 'save', 'bookmark', 'bookmarks', 'article', 'page',
]);

const MAX_SCORING_CONTENT = 20_000;

export interface RankedBookmark {
  bookmark: Bookmark;
  score: number;
  snippet: string;
}

function clean(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function queryTerms(query: string): string[] {
  const raw = clean(query).match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [];
  const useful = raw.filter((term) => term.length > 1 && !STOP_WORDS.has(term));
  return [...new Set(useful.length ? useful : raw.filter((term) => term.length > 1))].slice(0, 16);
}

function occurrences(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  let count = 0;
  let from = 0;
  while (count < 4) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count++;
    from = at + needle.length;
  }
  return count;
}

function fieldScore(value: unknown, terms: string[], phrase: string, weight: number): number {
  const text = clean(value);
  if (!text) return 0;
  let score = phrase.length > 2 && text.includes(phrase) ? weight * 4 : 0;
  let matched = 0;
  for (const term of terms) {
    const count = occurrences(text, term);
    if (!count) continue;
    matched++;
    score += weight * (1 + Math.min(3, count - 1) * 0.25);
    if (text.startsWith(term)) score += weight * 0.35;
  }
  if (terms.length > 1 && matched === terms.length) score += weight * 1.5;
  return score;
}

function dateValue(value?: string): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function bestSnippet(bookmark: Bookmark, query: string, maxChars = 520): string {
  const terms = queryTerms(query);
  const candidates = [bookmark.note, bookmark.summary, bookmark.description, bookmark.content]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.replace(/\s+/g, ' ').trim());
  if (!candidates.length) return '';

  let selected = candidates[0];
  let selectedAt = -1;
  let selectedRank = -1;
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const indexes = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0);
    const rank = indexes.length;
    const at = indexes.length ? Math.min(...indexes) : -1;
    if (rank > selectedRank || (rank === selectedRank && at >= 0 && (selectedAt < 0 || at < selectedAt))) {
      selected = candidate;
      selectedAt = at;
      selectedRank = rank;
    }
  }

  if (selected.length <= maxChars) return selected;
  const center = selectedAt >= 0 ? selectedAt : 0;
  const start = Math.max(0, Math.min(center - Math.floor(maxChars * 0.3), selected.length - maxChars));
  const end = Math.min(selected.length, start + maxChars);
  return `${start > 0 ? '…' : ''}${selected.slice(start, end).trim()}${end < selected.length ? '…' : ''}`;
}

export function rankBookmarks(query: string, corpus: Bookmark[], limit = 80): RankedBookmark[] {
  const phrase = clean(query);
  const terms = queryTerms(query);
  const seen = new Set<string>();
  const ranked: RankedBookmark[] = [];

  for (const bookmark of corpus) {
    if (!bookmark?.id || seen.has(bookmark.id) || bookmark.homeOnly) continue;
    seen.add(bookmark.id);

    let score = 0;
    score += fieldScore(bookmark.title, terms, phrase, 10);
    score += fieldScore([...(bookmark.tags ?? []), ...(bookmark.aiTags ?? [])].join(' '), terms, phrase, 8);
    score += fieldScore(bookmark.note, terms, phrase, 7);
    score += fieldScore(bookmark.summary, terms, phrase, 6);
    score += fieldScore(bookmark.description, terms, phrase, 4);
    score += fieldScore(`${bookmark.domain ?? ''} ${bookmark.url ?? ''}`, terms, phrase, 3);
    score += fieldScore(bookmark.content?.slice(0, MAX_SCORING_CONTENT), terms, phrase, 1.5);
    if (bookmark.favorite) score += 0.4;

    if (terms.length === 0) score += 1;
    if (score <= 0) continue;
    ranked.push({ bookmark, score, snippet: bestSnippet(bookmark, query) });
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      dateValue(b.bookmark.updated || b.bookmark.created) - dateValue(a.bookmark.updated || a.bookmark.created) ||
      a.bookmark.title.localeCompare(b.bookmark.title),
  );
  return ranked.slice(0, Math.max(1, limit));
}
