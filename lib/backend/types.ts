import {
  type Bookmark,
  type BookmarkType,
  type Collection,
  type Highlight,
  type HighlightColor,
  type Plan,
  type SortMode,
  type TextQuoteAnchor,
  type VaultStats,
} from '../types';

export interface SaveBookmarkInput {
  url: string;
  title: string;
  description?: string;
  summary?: string;
  content?: string;
  note?: string;
  tags?: string[];
  aiTags?: string[];
  collection?: string;
  cover?: string;
  favicon?: string;
  domain?: string;
  type?: BookmarkType;
  favorite?: boolean;
  pinned?: boolean;
  homeOnly?: boolean;
  sort?: number;
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
  // Home fast-path: return ONLY launcher rows (pinned || homeOnly) and, on
  // backends that support it, project away the heavy cached-content column so
  // a new tab transfers a few small tiles instead of the whole library.
  home?: boolean;
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
  plan: Plan;
}

// Owner admin: the single Stripe config row (test|live flag + PUBLIC
// publishable keys). Secret keys are NEVER part of this shape.
export interface BillingConfig {
  mode: 'test' | 'live';
  pkTest: string;
  pkLive: string;
}

export interface BillingEvent {
  id: string;
  type: string;
  created: string;
  handled?: boolean;
}

// Row shape of the PocketBase `plans` config collection. The extension can
// understand Free/Pro/Max rows; the server remains authoritative.
export interface PlanConfigRow {
  key: string; // 'free' | 'pro' | 'max'
  max_bookmarks: number | null;
  max_watches: number | null;
  max_storage_bytes: number | null;
  hosted_ai: boolean;
  ai_credit_allowance: number | null;
  ai_credit_period?: 'day' | 'month' | 'unlimited';
  capture_tier: string;
  stripe_price_month: string;
  stripe_price_year: string;
}

// Every data backend (local chrome.storage, PocketBase, …) implements this.
export interface Backend {
  readonly kind: 'local' | 'pocketbase';

  // auth
  init(): Promise<void>;
  renewAuthToken?(): Promise<void>;
  refreshUser?(): Promise<AuthUser | null>;
  fetchPlans?(): Promise<PlanConfigRow[]>;
  watchAuthChange?(cb: () => void): () => void;
  createCheckoutSession?(plan: 'pro' | 'max', interval: 'month' | 'year'): Promise<{ url: string }>;
  createPortalSession?(): Promise<{ url: string }>;

  // Optional owner-admin config. Server rules are authoritative.
  getBillingConfig?(): Promise<BillingConfig | null>;
  updateBillingConfig?(patch: Partial<BillingConfig>): Promise<BillingConfig>;
  recentBillingEvents?(limit?: number): Promise<BillingEvent[]>;
  login(email: string, password: string): Promise<AuthUser>;
  signup(email: string, password: string, name?: string): Promise<AuthUser>;
  requestPasswordReset?(email: string): Promise<void>;
  logout(): Promise<void>;
  currentUser(): AuthUser | null;
  isLoggedIn(): boolean;

  // bookmarks
  saveBookmark(input: SaveBookmarkInput): Promise<Bookmark>;
  watch?(cb: () => void): () => void;
  bulkSave?(inputs: SaveBookmarkInput[]): Promise<number>;
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
