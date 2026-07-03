import { storage } from 'wxt/utils/storage';
import { searchBookmarks } from './bookmarks';
import { saveHomeBookmark } from './home';
import { type Bookmark } from './types';

// Home dashboard widgets. Each widget is independent and degrades gracefully:
// a missing permission, an empty vault, or an offline weather fetch just hides
// that card — it never blanks Home. Enabled set + widget data live in local
// extension storage (per device); nothing here blocks first paint.

export type WidgetKey =
  | 'jumpback' // recently saved bookmarks
  | 'rediscover' // older saves you haven't opened in a while
  | 'notes' // freeform scratchpad
  | 'todo' // quick checklist
  | 'topsites' // Chrome most-visited, one-click add to Home
  | 'recentclosed' // reopen a tab you just closed
  | 'weather'; // opt-in local weather

export interface WidgetMeta {
  key: WidgetKey;
  label: string;
  hint: string;
  zone: 'strip' | 'card'; // strip = full-width row; card = grid cell
  needsPermission?: chrome.runtime.ManifestPermissions;
  needsHost?: string[]; // optional host permissions requested on enable
}

export const WIDGETS: WidgetMeta[] = [
  { key: 'jumpback', label: 'Jump back in', hint: 'Your most recent saves', zone: 'strip' },
  { key: 'rediscover', label: 'Rediscover', hint: 'Older saves worth another look', zone: 'strip' },
  { key: 'notes', label: 'Quick notes', hint: 'A scratchpad that autosaves', zone: 'card' },
  { key: 'todo', label: 'To-do', hint: 'A quick checklist', zone: 'card' },
  { key: 'topsites', label: 'Most visited', hint: 'Your top sites — one click to pin', zone: 'card', needsPermission: 'topSites' },
  { key: 'recentclosed', label: 'Recently closed', hint: 'Reopen a tab you just closed', zone: 'card', needsPermission: 'sessions' },
  {
    key: 'weather',
    label: 'Weather',
    hint: 'Local conditions (fetched anonymously)',
    zone: 'card',
    needsHost: ['https://api.open-meteo.com/*', 'https://ipapi.co/*'],
  },
];

// ── local widget data ────────────────────────────────────────────────────────

export const notesStore = storage.defineItem<string>('local:widget_notes', { fallback: '' });

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}
export const todosStore = storage.defineItem<Todo[]>('local:widget_todos', { fallback: [] });

// ── "surface my stuff" data ──────────────────────────────────────────────────

// Recent saves (newest first), excluding Home launcher tiles.
export async function recentSaves(limit = 8): Promise<Bookmark[]> {
  const list = await searchBookmarks('', { perPage: limit + 12, sort: 'newest' }).catch(() => []);
  return list.filter((b) => !b.homeOnly).slice(0, limit);
}

// Rediscover: oldest saves you haven't visited recently. Pulls a wider window,
// drops anything opened in the last week, and returns the stalest few.
export async function rediscoverSaves(limit = 8): Promise<Bookmark[]> {
  const list = await searchBookmarks('', { perPage: 120, sort: 'oldest' }).catch(() => []);
  const weekAgo = Date.now() - 7 * 24 * 3600_000;
  const fresh = list.filter((b) => !b.homeOnly);
  const stale = fresh.filter((b) => !b.lastVisited || new Date(b.lastVisited).getTime() < weekAgo);
  return (stale.length ? stale : fresh).slice(0, limit);
}

// Pin any URL straight to Home (used by the Most-visited widget).
export async function pinToHome(url: string, title: string, favicon?: string): Promise<void> {
  await saveHomeBookmark({ url, title: title || url, favicon, pinned: true, homeOnly: true, sort: Date.now() });
}

// ── Chrome-surface widgets ───────────────────────────────────────────────────

export interface TopSite {
  url: string;
  title: string;
}
export async function getTopSites(limit = 10): Promise<TopSite[]> {
  try {
    if (!browser.topSites) return [];
    const sites = await browser.topSites.get();
    return sites.slice(0, limit).map((s) => ({ url: s.url, title: s.title || s.url }));
  } catch {
    return [];
  }
}

export interface ClosedTab {
  url: string;
  title: string;
  sessionId?: string;
}
export async function getRecentlyClosed(limit = 8): Promise<ClosedTab[]> {
  try {
    if (!browser.sessions) return [];
    const sessions = await browser.sessions.getRecentlyClosed({ maxResults: limit + 4 });
    const out: ClosedTab[] = [];
    for (const s of sessions) {
      if (s.tab?.url && !s.tab.url.startsWith('chrome')) {
        out.push({ url: s.tab.url, title: s.tab.title || s.tab.url, sessionId: s.tab.sessionId });
      }
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function restoreClosed(sessionId?: string): Promise<void> {
  try {
    await browser.sessions?.restore(sessionId);
  } catch {
    /* fall back to a normal open handled by the caller */
  }
}

// ── weather (opt-in, best-effort) ────────────────────────────────────────────

export interface Weather {
  tempC: number;
  tempF: number;
  code: number;
  place: string;
  fetchedAt: number;
}
const weatherCache = storage.defineItem<Weather | null>('local:widget_weather', { fallback: null });

const WEATHER_CODES: Record<number, { label: string; icon: string }> = {
  0: { label: 'Clear', icon: '☀️' },
  1: { label: 'Mostly clear', icon: '🌤️' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Fog', icon: '🌫️' },
  48: { label: 'Fog', icon: '🌫️' },
  51: { label: 'Drizzle', icon: '🌦️' },
  61: { label: 'Rain', icon: '🌧️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  71: { label: 'Snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '🌨️' },
  75: { label: 'Heavy snow', icon: '❄️' },
  80: { label: 'Showers', icon: '🌦️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
};
export function weatherLook(code: number): { label: string; icon: string } {
  return WEATHER_CODES[code] ?? { label: 'Weather', icon: '🌡️' };
}

// Fetch weather, using an anonymous IP-based location (no GPS prompt). Cached
// for an hour. Returns null on any failure — the widget then simply hides.
export async function fetchWeather(force = false): Promise<Weather | null> {
  const cached = await weatherCache.getValue();
  if (!force && cached && Date.now() - cached.fetchedAt < 3600_000) return cached;
  try {
    const loc = await fetch('https://ipapi.co/json/').then((r) => r.json());
    if (typeof loc?.latitude !== 'number') return cached;
    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code&temperature_unit=celsius`,
    ).then((r) => r.json());
    const cur = w?.current;
    if (typeof cur?.temperature_2m !== 'number') return cached;
    const tempC = Math.round(cur.temperature_2m);
    const out: Weather = {
      tempC,
      tempF: Math.round((tempC * 9) / 5 + 32),
      code: cur.weather_code ?? 0,
      place: loc.city || loc.region || '',
      fetchedAt: Date.now(),
    };
    await weatherCache.setValue(out);
    return out;
  } catch {
    return cached;
  }
}
