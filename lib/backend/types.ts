import {
  type Bookmark,
  type BookmarkType,
  type Collection,
  type Highlight,
  type HighlightColor,
  type SortMode,
  type TextQuoteAnchor,
  type VaultStats,
} from '../types';

export interface SaveBookmarkInput {
  url: string;
  title: string;
  description?: string;
  summary?: string;
  note?: string;
  tags?: string[];
  aiTags?: string[];
  collection?: string;
  cover?: string;
  favicon?: string;
  domain?: string;
  type?: BookmarkType;
  favorite?: boolean;
  readingTime?: number;
  screenshotBlob?: Blob;
}

export interface SearchOpts {
  collection?: string;
  tag?: string;
  type?: BookmarkType;
  favorite?: boolean;
  untagged?: boolean;
  sort?: SortMode;
  page?: number;
  perPage?: number;
}

export interface CreateHighlightInput {
  url: string;
  text: string;
  color?: HighlightColor;
  note?: string;
  bookmark?: string;
  anchor?: TextQuoteAnchor;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

// Every data backend (local chrome.storage, PocketBase, …) implements this.
// The UI talks only to this interface, so swapping backends is a config flip.
export interface Backend {
  readonly kind: 'local' | 'pocketbase';

  // auth
  init(): Promise<void>;
  login(email: string, password: string): Promise<AuthUser>;
  signup(email: string, password: string, name?: string): Promise<AuthUser>;
  logout(): Promise<void>;
  currentUser(): AuthUser | null;
  isLoggedIn(): boolean;

  // bookmarks
  saveBookmark(input: SaveBookmarkInput): Promise<Bookmark>;
  updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark>;
  deleteBookmark(id: string): Promise<void>;
  searchBookmarks(query: string, opts?: SearchOpts): Promise<Bookmark[]>;
  findByUrl(url: string): Promise<Bookmark | null>;
  markVisited(id: string): Promise<void>;
  getAllTags(): Promise<{ tag: string; count: number }[]>;
  countByCollection(): Promise<Record<string, number>>;
  vaultStats(): Promise<VaultStats>;

  // collections
  listCollections(): Promise<Collection[]>;
  createCollection(data: { name: string; color?: string; icon?: string; parent?: string }): Promise<Collection>;
  updateCollection(id: string, patch: Partial<Collection>): Promise<Collection>;
  deleteCollection(id: string): Promise<void>;

  // highlights
  createHighlight(input: CreateHighlightInput): Promise<Highlight>;
  highlightsForUrl(url: string): Promise<Highlight[]>;
  allHighlights(limit?: number): Promise<Highlight[]>;
  deleteHighlight(id: string): Promise<void>;
  updateHighlight(id: string, patch: { note?: string; color?: HighlightColor }): Promise<void>;
}
