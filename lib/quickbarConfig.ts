import { type Collection, type QuickBarAction } from './types';

export const DEFAULT_QUICKBAR_ORDER: QuickBarAction[] = [
  'popup',
  'search',
  'browse',
  'ai',
  'related',
  'save',
  'folder',
  'dashboard',
  'custom',
];

const ACTIONS = new Set<QuickBarAction>(DEFAULT_QUICKBAR_ORDER);

export function normalizeQuickBarOrder(value: unknown): QuickBarAction[] {
  const input = Array.isArray(value) ? value : [];
  const result: QuickBarAction[] = [];
  for (const item of input) {
    if (typeof item !== 'string' || !ACTIONS.has(item as QuickBarAction)) continue;
    const action = item as QuickBarAction;
    if (!result.includes(action)) result.push(action);
  }

  // Existing 8.10.2 users already have a five-action custom order. Insert the
  // new discovery actions beside Popup instead of silently burying them after
  // Dashboard/Custom. Once present, the user's exact drag order is preserved.
  const popupIndex = result.indexOf('popup');
  let insertion = popupIndex >= 0 ? popupIndex + 1 : 0;
  for (const action of ['search', 'browse', 'ai', 'related'] as QuickBarAction[]) {
    if (!result.includes(action)) {
      result.splice(insertion, 0, action);
      insertion++;
    }
  }

  for (const action of DEFAULT_QUICKBAR_ORDER) {
    if (!result.includes(action)) result.push(action);
  }
  return result;
}

export function reorderQuickBarAction(
  order: QuickBarAction[],
  dragged: QuickBarAction,
  target: QuickBarAction,
): QuickBarAction[] {
  const normalized = normalizeQuickBarOrder(order);
  if (dragged === target) return normalized;
  const without = normalized.filter((item) => item !== dragged);
  const targetIndex = without.indexOf(target);
  if (targetIndex < 0) return normalized;
  without.splice(targetIndex, 0, dragged);
  return without;
}

export const QUICKBAR_WIDTH_MIN = 34;
export const QUICKBAR_WIDTH_MAX = 86;
export const QUICKBAR_WIDTH_DEFAULT = 50;
export const QUICKBAR_ICON_MIN = 14;
export const QUICKBAR_ICON_MAX = 26;
export const QUICKBAR_ICON_DEFAULT = 20;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.max(min, Math.min(max, parsed)));
}

export function normalizeQuickBarWidth(value: unknown): number {
  return clampNumber(value, QUICKBAR_WIDTH_DEFAULT, QUICKBAR_WIDTH_MIN, QUICKBAR_WIDTH_MAX);
}

export function normalizeQuickBarIconSize(value: unknown): number {
  return clampNumber(value, QUICKBAR_ICON_DEFAULT, QUICKBAR_ICON_MIN, QUICKBAR_ICON_MAX);
}

export function normalizeQuickBarColor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return '';
}

export function normalizeQuickBarUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

// `undefined` normally means "use the default collection". The folder picker
// needs a separate explicit flag so its Unsorted row can intentionally clear
// the destination instead of accidentally falling back to that default.
export function resolveSaveCollection(
  selected: string | undefined,
  defaultCollection: string | undefined,
  explicit: boolean,
): string | undefined {
  return explicit ? selected || '' : selected ?? defaultCollection;
}

export function rememberRecentCollection(current: unknown, id: string | undefined, limit = 3): string[] {
  const safe = Array.isArray(current) ? current.filter((item): item is string => typeof item === 'string' && Boolean(item)) : [];
  if (!id) return [...new Set(safe)].slice(0, limit);
  return [id, ...safe.filter((item) => item !== id)].slice(0, Math.max(1, limit));
}

export function splitRecentCollections(
  collections: Collection[],
  recentIds: unknown,
): { recent: Collection[]; rest: Collection[] } {
  const ids = Array.isArray(recentIds) ? recentIds.filter((item): item is string => typeof item === 'string') : [];
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const recent = ids.map((id) => byId.get(id)).filter((item): item is Collection => Boolean(item));
  const recentSet = new Set(recent.map((collection) => collection.id));
  return { recent, rest: collections.filter((collection) => !recentSet.has(collection.id)) };
}

export function buildRelatedQuery(title: string, url: string): string {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '').split('.')[0] ?? '';
  } catch {
    /* title-only fallback */
  }
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'your', 'you', 'how', 'what', 'why', 'are']);
  const words = `${title} ${host}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word));
  return [...new Set(words)].slice(0, 6).join(' ');
}

export function sameCanonicalUrl(a: string, b: string): boolean {
  const normalize = (value: string) => {
    try {
      const parsed = new URL(value);
      parsed.hash = '';
      for (const key of [...parsed.searchParams.keys()]) {
        if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') parsed.searchParams.delete(key);
      }
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}${parsed.search}`;
    } catch {
      return value.replace(/#.*$/, '').replace(/\/$/, '');
    }
  };
  return normalize(a) === normalize(b);
}
