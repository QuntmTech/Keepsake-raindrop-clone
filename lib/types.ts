// Shared data models. Mirror these in your PocketBase collections (see pocketbase/schema.md).

export interface Collection {
  id: string;
  name: string;
  color?: string;
  icon?: string;
  parent?: string; // collection id, for nesting
  user: string;    // owner relation
  created: string;
  updated: string;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  description?: string;
  tags: string[];
  collection?: string;       // collection id
  cover?: string;            // file name in PB, or remote URL
  screenshot?: string;       // file name in PB (auto preview)
  domain?: string;
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
  anchor?: string;           // JSON-serialized range anchor (Claude Code: harden this)
  user: string;
  created: string;
  updated: string;
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange';

// Which UI opens when the toolbar icon is clicked. Configurable in Options.
export type UiSurface = 'popup' | 'sidepanel' | 'dashboard';

export interface Settings {
  // Primary surface fired by clicking the extension icon.
  primarySurface: UiSurface;
  // Feature toggles — let the user turn pieces on/off.
  enableHighlights: boolean;
  enableAutoScreenshot: boolean;
  theme: 'system' | 'light' | 'dark';
  defaultCollection?: string; // collection id new saves drop into
}

export const DEFAULT_SETTINGS: Settings = {
  primarySurface: 'popup',
  enableHighlights: true,
  enableAutoScreenshot: true,
  theme: 'system',
};
