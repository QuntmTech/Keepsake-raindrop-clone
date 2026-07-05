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
// publishable keys). Secret keys are NEVER part of this shape — they live only
// in the backend's server-side env, selected by `mode`.
export interface BillingConfig {
  mode: 'test' | 'live';
  pkTest: string; // pk_test_… (public — safe to display/edit)
  pkLive: string; // pk_live_… (public)
}

// Owner admin: one recent webhook/subscription event, for sanity-checking
// (read-only). Comes from the PB `webhook_events` log.
export interface BillingEvent {
  id: string;
  type: string;
  created: string;
  handled?: boolean;
}

// Row shape of the PocketBase `plans` config collection (snake_case wire
// fields). The client reads these to drive entitlements data-drivenly; see
// lib/entitlements.ts. Empty/absent numeric cap => unlimited.
export interface PlanConfigRow {
  key: string; // 'free' | 'pro'
  max_bookmarks: number | null;
  max_watches: number | null;
  max_storage_bytes: number | null;
  hosted_ai: boolean;
  ai_credit_allowance: number | null;
  capture_tier: string; // 'basic' | 'full'
  stripe_price_month: string;
  stripe_price_year: string;
}

// Every data backend (local chrome.storage, PocketBase, …) implements this.
// The UI talks only to this interface, so swapping backends is a config flip.
export interface Backend {
  readonly kind: 'local' | 'pocketbase';

  // auth
  init(): Promise<void>;
  // Optional: renew the auth token so active sessions never hard-expire
  // (PocketBase). Local mode has no tokens and skips it.
  renewAuthToken?(): Promise<void>;
  // Optional: force an immediate re-read of the signed-in user record
  // (bypassing any refresh throttle) so a plan change — e.g. a completed Stripe
  // upgrade — is picked up right away. Returns the fresh user, or null.
  refreshUser?(): Promise<AuthUser | null>;
  // Optional: read the data-driven plan/limits config (PocketBase `plans`
  // collection). Absent on backends without it (local mode).
  fetchPlans?(): Promise<PlanConfigRow[]>;
  // Optional: notify when the signed-in user's auth record changes in ANY
  // context (e.g. a background refresh picks up a Stripe-upgraded plan) so
  // open UIs can re-read plan/email live instead of only at initial load.
  watchAuthChange?(cb: () => void): () => void;
  // Optional Stripe billing (PocketBase only — see lib/config.ts route
  // constants + /docs/POCKETBASE_BUILD_PROMPT.md for the server contract).
  // Both return a Stripe-hosted URL to open in a new tab; absent entirely on
  // backends without billing (local mode).
  createCheckoutSession?(plan: 'pro', interval: 'month' | 'year'): Promise<{ url: string }>;
  createPortalSession?(): Promise<{ url: string }>;

  // Optional owner-admin config (PocketBase only; server enforces owner-scoped
  // rules — the client gate is UX only). Read/flip the test|live mode + public
  // publishable keys, and read recent webhook events. null / [] when the
  // billing collections don't exist yet.
  getBillingConfig?(): Promise<BillingConfig | null>;
  updateBillingConfig?(patch: Partial<BillingConfig>): Promise<BillingConfig>;
  recentBillingEvents?(limit?: number): Promise<BillingEvent[]>;
  login(email: string, password: string): Promise<AuthUser>;
  signup(email: string, password: string, name?: string): Promise<AuthUser>;
  // Optional: email a password-reset link (PocketBase). Local mode has none.
  requestPasswordReset?(email: string): Promise<void>;
  logout(): Promise<void>;
  currentUser(): AuthUser | null;
  isLoggedIn(): boolean;

  // bookmarks
  saveBookmark(input: SaveBookmarkInput): Promise<Bookmark>;
  // Optional: notify when the vault changes (any context) so open UIs refresh live.
  watch?(cb: () => void): () => void;
  // Optional fast path for bulk imports (single write where possible). Returns count saved.
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
