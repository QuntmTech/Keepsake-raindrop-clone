import { type BookmarkType, type SortMode } from './types';

// Pure helpers shared across backends + UI. No I/O, no backend coupling.

export function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// A free favicon for any domain (Google's S2 service — no key, cached by Google).
export function faviconFor(domain: string): string | undefined {
  if (!domain) return undefined;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// Best-effort content type from the URL alone.
export function inferType(url: string): BookmarkType {
  const u = url.toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com|\.mp4($|\?)/.test(u)) return 'video';
  if (/\.(png|jpe?g|gif|webp|svg|avif)($|\?)/.test(u)) return 'image';
  if (/\.pdf($|\?)/.test(u)) return 'pdf';
  if (/github\.com|gitlab\.com|bitbucket\.org/.test(u)) return 'repo';
  if (/docs\.google\.com|notion\.so|\.md($|\?)/.test(u)) return 'doc';
  return 'link';
}

export function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t) => typeof t === 'string');
  if (typeof raw === 'string' && raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const SORT_FILTER: Record<SortMode, string> = {
  newest: '-created',
  oldest: 'created',
  title: 'title',
  domain: 'domain',
  lastVisited: '-lastVisited',
};

// Compare two bookmarks for client-side sorting (used by the local backend).
export function compareBy(sort: SortMode) {
  return (a: any, b: any): number => {
    switch (sort) {
      case 'oldest':
        return a.created.localeCompare(b.created);
      case 'title':
        return (a.title || '').localeCompare(b.title || '');
      case 'domain':
        return (a.domain || '').localeCompare(b.domain || '');
      case 'lastVisited':
        return (b.lastVisited || '').localeCompare(a.lastVisited || '');
      case 'newest':
      default:
        return b.created.localeCompare(a.created);
    }
  };
}

// Random PocketBase-style 15-char id for local records.
export function genId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const rnd = crypto.getRandomValues(new Uint8Array(15));
  for (let i = 0; i < 15; i++) id += chars[rnd[i] % chars.length];
  return id;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function escFilter(s: string): string {
  return s.replace(/"/g, '\\"');
}

// Human "saved N ago" label shared by notifications and recall UI.
export function agoLabel(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} month${days >= 60 ? 's' : ''} ago`;
  return `${Math.round(days / 365)} year${days >= 730 ? 's' : ''} ago`;
}
