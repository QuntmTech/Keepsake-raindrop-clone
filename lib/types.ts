// Shared data models. Mirror these in your PocketBase collections (see pocketbase/schema.md).

export interface Collection {
  id: string;
  name: string;
  color?: string;
  icon?: string;       // emoji or icon key
  parent?: string;     // collection id, for nesting
  sort?: number;       // manual ordering within a parent
  user: string;        // owner relation
  created: string;
  updated: string;
}

// Coarse content type, inferred on save. Drives card layout + filtering.
export type BookmarkType = 'article' | 'video' | 'image' | 'pdf' | 'repo' | 'doc' | 'link';

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  description?: string;
  summary?: string;          // AI-generated TL;DR
  content?: string;          // cached page text (link-rot-proof reading copy)
  note?: string;             // user's own note
  tags: string[];
  aiTags?: string[];         // tags suggested by AI (kept distinct so user edits win)
  collection?: string;       // collection id
  cover?: string;            // remote cover image URL (og:image) or PB file
  favicon?: string;          // site favicon URL
  screenshot?: string;       // file URL in PB (auto preview)
  domain?: string;
  type: BookmarkType;
  favorite?: boolean;
  pinned?: boolean;          // shown on the Home screen (curated — separate from the library)
  homeOnly?: boolean;        // a Home app tile (from the catalog) — hidden from library views
  sort?: number;             // manual order for Home tiles / lists
  readingTime?: number;      // minutes
  broken?: boolean;          // link-checker flagged it as dead
  lastVisited?: string;      // ISO date of last open from within Keepsake
  user: string;              // owner relation
  created: string;
  updated: string;
}

export interface Highlight {
  id: string;
  bookmark?: string;         // optional link to a saved bookmark
  url: string;               // page the highlight lives on
  text: string;              // the highlighted text
  note?: string;             // user annotation
  color: HighlightColor;
  anchor?: string;           // JSON-serialized TextQuoteAnchor for robust re-anchoring
  user: string;
  created: string;
  updated: string;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

// Account tier. `owner` is you (unlimited, forever); `pro` is a paid customer;
// `free` is the default limited tier. Stored on the user record (`plan`).
export type Plan = 'free' | 'pro' | 'owner';

// Robust highlight anchor — quote + surrounding context survives DOM changes
// far better than a raw first-match search. Serialized into Highlight.anchor.
export interface TextQuoteAnchor {
  exact: string;
  prefix?: string;
  suffix?: string;
}

// Which UI opens when the toolbar icon is clicked. Configurable in Options.
export type UiSurface = 'popup' | 'sidepanel' | 'dashboard';

// Library layout modes.
export type ViewMode = 'grid' | 'list' | 'masonry';
export type SortMode = 'newest' | 'oldest' | 'title' | 'domain' | 'lastVisited';

export type ThemeMode = 'system' | 'light' | 'dark';

// Named accent palettes for the UI. Hex values live in lib/theme.ts.
export type Accent = 'ocean' | 'violet' | 'emerald' | 'sunset' | 'rose' | 'slate';

// AI provider config. The key lives in chrome.storage.local (never synced,
// never leaves the device except in calls to the model API).
export type LlmProvider = 'anthropic' | 'openai' | 'google';

export interface AiSettings {
  enabled: boolean;
  provider: LlmProvider;     // which provider the BYOK key belongs to
  apiKey: string;
  autoTag: boolean;          // suggest tags on save
  autoSummarize: boolean;    // generate a TL;DR on save
  autoFile: boolean;         // zero-organization auto-filing on save
  fastModel: string;         // tagging/summarizing/filing (cheap + quick)
  smartModel: string;        // "ask your library" Q&A
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: 'anthropic',
  apiKey: '',
  autoTag: true,
  autoSummarize: true,
  autoFile: true,
  fastModel: 'claude-haiku-4-5',
  smartModel: 'claude-opus-4-8',
};

export interface Settings {
  // Primary surface fired by clicking the extension icon.
  primarySurface: UiSurface;
  // Feature toggles — let the user turn pieces on/off.
  enableHighlights: boolean;
  enableAutoScreenshot: boolean;
  enableMetadata: boolean;   // fetch og:image / favicon / reading time on save
  enableQuickBar: boolean;   // draggable in-page quick-save widget
  quickBarY: number;         // 0..1 vertical position of the quick bar on the edge
  theme: ThemeMode;
  accent: Accent;
  view: ViewMode;
  sort: SortMode;
  newTabMode: 'home' | 'minimal'; // Keepsake Home new-tab: full or search-only
  homeWidgets: string[]; // enabled dashboard widget keys, in display order
  widgetColor: string; // custom widget-card background ('' = themed default)
  wallpaper: string; // Home background: '' | preset key | 'url:<image>'
  searchEngine: 'google' | 'duckduckgo' | 'bing' | 'brave' | 'ecosia'; // Home web search
  defaultCollection?: string; // collection id new saves drop into
  // Ambient Recall — matching runs 100% locally; nothing leaves the device.
  recallEnabled: boolean;     // opt-in: surface related saves while browsing
  recallBlocklist: string[];  // domains never matched (banking etc.)
}

export const DEFAULT_SETTINGS: Settings = {
  primarySurface: 'popup',
  enableHighlights: true,
  enableAutoScreenshot: true,
  enableMetadata: true,
  enableQuickBar: true,
  quickBarY: 0.5,
  theme: 'system',
  accent: 'ocean',
  view: 'grid',
  sort: 'newest',
  newTabMode: 'home',
  homeWidgets: ['jumpback', 'notes', 'todo', 'topsites', 'recentclosed'],
  widgetColor: '',
  wallpaper: 'dusk',
  searchEngine: 'google',
  recallEnabled: false,
  recallBlocklist: [],
};

// Aggregate stats for the dashboard header.
export interface VaultStats {
  total: number;
  collections: number;
  tags: number;
  highlights: number;
  favorites: number;
}
