// Web-search engine choice for the Home search box (so Keepsake can fully stand
// in for your browser's start page). Stored in Settings.searchEngine.

export type SearchEngine = 'google' | 'duckduckgo' | 'bing' | 'brave' | 'ecosia';

export const SEARCH_ENGINES: { key: SearchEngine; label: string; url: string }[] = [
  { key: 'google', label: 'Google', url: 'https://www.google.com/search?q=' },
  { key: 'duckduckgo', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  { key: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=' },
  { key: 'brave', label: 'Brave', url: 'https://search.brave.com/search?q=' },
  { key: 'ecosia', label: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
];

export function searchUrl(engine: SearchEngine, query: string): string {
  const e = SEARCH_ENGINES.find((x) => x.key === engine) ?? SEARCH_ENGINES[0];
  return e.url + encodeURIComponent(query);
}
