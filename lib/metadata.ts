import { type BookmarkType } from './types';

export interface PageMeta {
  title?: string;
  description?: string;
  cover?: string;       // og:image (absolute URL)
  favicon?: string;     // absolute URL
  author?: string;
  type?: BookmarkType;
  readingTime?: number; // minutes
  text?: string;        // trimmed main text excerpt (for AI context)
}

// IMPORTANT: this function is serialized and injected into the page via
// chrome.scripting.executeScript, so it must be fully self-contained — no
// imports, no references to module-scope variables.
export function extractPageMeta(): PageMeta {
  const pick = (sel: string, attr = 'content'): string | undefined => {
    const el = document.querySelector(sel);
    const v = el?.getAttribute(attr) ?? undefined;
    return v || undefined;
  };
  const abs = (u?: string): string | undefined => {
    if (!u) return undefined;
    try {
      return new URL(u, location.href).href;
    } catch {
      return undefined;
    }
  };

  const meta: PageMeta = {};
  meta.title =
    pick('meta[property="og:title"]') || document.title || undefined;
  meta.description =
    pick('meta[property="og:description"]') ||
    pick('meta[name="description"]') ||
    pick('meta[name="twitter:description"]');
  meta.cover = abs(
    pick('meta[property="og:image"]') ||
      pick('meta[name="twitter:image"]') ||
      pick('meta[name="twitter:image:src"]'),
  );
  meta.author =
    pick('meta[name="author"]') || pick('meta[property="article:author"]');

  // Favicon: prefer a declared icon, else the conventional /favicon.ico.
  const iconHref =
    document.querySelector<HTMLLinkElement>(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
    )?.href;
  meta.favicon = abs(iconHref) || `${location.origin}/favicon.ico`;

  const ogType = pick('meta[property="og:type"]')?.toLowerCase() ?? '';
  if (ogType.includes('video')) meta.type = 'video';
  else if (ogType.includes('article')) meta.type = 'article';

  // Reading time + excerpt from the densest text container.
  const article = document.querySelector('article') ?? document.body;
  const text = (article?.innerText ?? '').replace(/\s+/g, ' ').trim();
  if (text) {
    const words = text.split(' ').length;
    meta.readingTime = Math.max(1, Math.round(words / 220));
    meta.text = text.slice(0, 5000);
    if (!meta.type && words > 400) meta.type = 'article';
  }
  return meta;
}
