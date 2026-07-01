// Curated "Add to Home" app catalog, seeded from lib/suggested-apps.json —
// popular sites grouped by category, with brand icons served by Google's
// favicon service (no bundled assets). Users one-click add single apps as
// pinned Home tiles, add a whole category as a ready-made collection, or
// create a fully custom app.

import seed from './suggested-apps.json';

export interface CatalogApp {
  category: string;
  name: string;
  url: string;
  icon: string;
}

export interface CatalogCategory {
  name: string;
  apps: CatalogApp[];
}

export const APP_CATALOG: CatalogApp[] = seed;

// Categories in seed-file order, apps in listed order.
export const APP_CATEGORIES: CatalogCategory[] = APP_CATALOG.reduce<CatalogCategory[]>((cats, app) => {
  const last = cats[cats.length - 1];
  if (last && last.name === app.category) last.apps.push(app);
  else cats.push({ name: app.category, apps: [app] });
  return cats;
}, []);

// Accent colors for auto-created cluster collections, one per category.
const CATEGORY_COLORS = ['#4f7cf7', '#b45309', '#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#ef4444'];
export function categoryColor(name: string): string {
  const i = APP_CATEGORIES.findIndex((c) => c.name === name);
  return CATEGORY_COLORS[(i < 0 ? 0 : i) % CATEGORY_COLORS.length];
}

export function appIcon(url: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`;
  } catch {
    return '';
  }
}

// Normalize a URL for "already added" checks (host minus www + path minus slash).
export function normUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase() + u.pathname.replace(/\/+$/, '');
  } catch {
    return url.toLowerCase();
  }
}
