import PocketBase from 'pocketbase';
import { storage } from 'wxt/utils/storage';
import {
  type Bookmark,
  type BookmarkType,
  type Collection,
  type Highlight,
  type HighlightColor,
  type VaultStats,
} from '../types';
import { faviconFor, inferType, parseTags, safeDomain, SORT_FILTER, escFilter } from '../util';
import { HOSTED_PB_URL, PB_CHECKOUT_ROUTE, PB_PORTAL_ROUTE } from '../config';
import { mark } from '../boottrace';
import {
  type AuthUser,
  type Backend,
  type BillingConfig,
  type BillingEvent,
  type CreateHighlightInput,
  type PlanConfigRow,
  type SaveBookmarkInput,
  type SearchOpts,
} from './types';

// PocketBase-backed implementation. Kept behind the same Backend interface so
// the UI doesn't change when you switch to it. See pocketbase/schema.md.

// The server URL is configurable at runtime (Settings → Storage) so users can
// paste their PocketHost/self-hosted URL without rebuilding the extension.
const pbUrlStore = storage.defineItem<string>('sync:pb_url', {
  fallback: HOSTED_PB_URL,
});
const authMirror = storage.defineItem<string | null>('local:pb_auth', { fallback: null });

// Auth tokens expire server-side (~30 days). The SDK never renews them on its
// own, so without a refresh an active user gets silently logged out and every
// request 401s. We renew opportunistically on init + a background alarm,
// throttled through storage so the many extension contexts don't stampede.
const lastRefreshStore = storage.defineItem<number>('local:pb_last_refresh', { fallback: 0 });
const REFRESH_EVERY = 6 * 3600_000; // at most one refresh per 6h
const RETRY_AFTER = 30 * 60_000; // transient failure -> allow retry in 30min

// Home tiles need everything `normalize` reads EXCEPT `content` — the cached
// full-page text, by far the largest column. Fetching Home with this
// projection keeps a new tab's payload to a few KB per tile instead of pulling
// each pinned page's entire text. Kept in sync with normalize(): any field the
// UI reads must be listed, or it round-trips as empty. `content` is the only
// deliberate omission (nothing on Home renders or re-saves it).
const HOME_TILE_FIELDS = [
  'id', 'collectionId', 'url', 'title', 'description', 'summary', 'note', 'tags', 'aiTags',
  'collection', 'domain', 'type', 'favorite', 'pinned', 'homeOnly', 'sort', 'readingTime',
  'broken', 'lastVisited', 'cover', 'favicon', 'screenshot', 'user', 'created', 'updated',
].join(',');

export async function getPbUrl(): Promise<string> {
  return (await pbUrlStore.getValue()) || '';
}
export async function setPbUrl(url: string): Promise<void> {
  // Normalize: trim and strip a trailing slash.
  await pbUrlStore.setValue(url.trim().replace(/\/+$/, ''));
}

// Translate PocketBase auth errors into clear, user-facing messages.
function authError(e: unknown, kind: 'login' | 'signup'): string {
  const status = (e as { status?: number })?.status;
  if (status === 429) return 'Too many attempts — wait a few seconds and try again.';
  if (!status) return 'Can’t reach the server — check your connection and try again.';
  if (kind === 'login' && (status === 400 || status === 401 || status === 403))
    return 'Wrong email or password.';
  if (kind === 'signup' && status === 400)
    return 'Could not sign up — that email may already be in use, or the password is too short.';
  return (e as { message?: string })?.message || 'Something went wrong.';
}

export class PocketBaseBackend implements Backend {
  readonly kind = 'pocketbase' as const;
  private pb = new PocketBase('http://127.0.0.1:8090');
  private url = '';
  private wired = false;
  // Most recent server Retry-After (rate-limit), in ms + when it was seen —
  // captured in afterSend so req()'s backoff waits the exact server interval.
  private retryAfterMs = 0;
  private retryAfterAt = 0;

  async init(): Promise<void> {
    // Hosted builds have the server baked in — use it IMMEDIATELY and never block
    // boot on a chrome.storage.sync read. On the first new-tab open after the
    // browser starts, chrome.storage.sync.get() can stall for hundreds of ms to
    // several seconds while Chrome spins up its sync layer, and everything below
    // (session restore, currentUser(), and the snapshot tile paint that calls it)
    // was serialized behind that read — the #1 cause of a slow cold Home. The
    // sync:pb_url override only exists for dev/staging where no URL is baked in,
    // and it's hidden from users in hosted builds, so awaiting it on the critical
    // path is pure dead weight. This mirrors how the backend-mode sync read is
    // already skipped when HOSTED. Precedence: baked-in URL first (short-circuits
    // the await entirely in every published build); the sync override is only
    // consulted in a dev build where HOSTED_PB_URL is empty.
    this.url = HOSTED_PB_URL || (await pbUrlStore.getValue()) || 'http://127.0.0.1:8090';
    mark('pb:url'); // hosted: NO sync read reached here; dev-only fallback may read sync
    this.pb = new PocketBase(this.url);
    // CRITICAL: the SDK auto-cancels duplicate in-flight requests by default,
    // which makes concurrent list/search calls (collections + bookmarks +
    // counts on open) reject as "autocancelled" and show up empty until a later
    // request lands. Turn it off so every request completes.
    this.pb.autoCancellation(false);
    // A dead connection must not freeze a popup or page action. Abort each
    // attempt after 8s; safe reads/updates get one bounded retry.
    this.pb.beforeSend = (url, options) => {
      options.signal ??= AbortSignal.timeout(8_000);
      return { url, options };
    };
    // afterSend fires even for the 429 error response (verified against the SDK),
    // so capture Retry-After here — it's the only place the raw header is
    // reachable (ClientResponseError drops response headers). req() reads it.
    this.pb.afterSend = (response, data) => {
      if (response.status === 429) {
        const secs = parseInt(response.headers.get('retry-after') ?? '', 10);
        if (secs > 0) {
          this.retryAfterMs = secs * 1000;
          this.retryAfterAt = Date.now();
        }
      }
      return data;
    };

    const saved = await authMirror.getValue();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.pb.authStore.save(parsed.token, parsed.record);
      } catch {
        await authMirror.setValue(null);
      }
    }
    mark('pb:session'); // storage.local session restore finished
    if (!this.wired) {
      this.wired = true;
      this.pb.authStore.onChange(() => {
        authMirror.setValue(
          this.pb.authStore.isValid
            ? JSON.stringify({ token: this.pb.authStore.token, record: this.pb.authStore.record })
            : null,
        );
      });
      // Sync auth across contexts (log in via popup -> content script sees it).
      authMirror.watch((saved) => {
        if (!saved) {
          this.pb.authStore.clear();
          return;
        }
        try {
          const parsed = JSON.parse(saved);
          if (parsed.token !== this.pb.authStore.token) {
            this.pb.authStore.save(parsed.token, parsed.record);
          }
        } catch {
          /* ignore */
        }
      });
    }
    // Renew the token in the background — never block init (first paint) on it.
    this.renewAuthToken().catch(() => {});
  }

  // Keep the session alive: exchange the current token for a fresh one so an
  // active user is never silently logged out by server-side token expiry.
  async renewAuthToken(): Promise<void> {
    if (!this.pb.authStore.isValid) return;
    const last = await lastRefreshStore.getValue();
    if (Date.now() - last < REFRESH_EVERY) return;
    // Claim the slot BEFORE calling out so concurrent contexts don't stampede.
    await lastRefreshStore.setValue(Date.now());
    try {
      await this.pb.collection('users').authRefresh();
      // authStore.onChange mirrors the new token to every context.
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 401 || status === 403) {
        // The token is truly dead — clear it so the UI shows a login form
        // instead of every request silently failing.
        this.pb.authStore.clear();
        await authMirror.setValue(null);
      } else {
        // Offline / server hiccup: keep the session, allow a retry soon.
        await lastRefreshStore.setValue(Date.now() - REFRESH_EVERY + RETRY_AFTER);
      }
    }
  }

  // Force an immediate session refresh (bypasses the 6h throttle in
  // renewAuthToken) so a plan change — e.g. a completed Stripe upgrade written
  // by the webhook — is reflected in the client without a re-login. onChange
  // mirrors the fresh record (incl. plan) to every context.
  async refreshUser(): Promise<AuthUser | null> {
    if (!this.pb.authStore.isValid) return null;
    try {
      await this.pb.collection('users').authRefresh();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 401 || status === 403) {
        this.pb.authStore.clear();
        await authMirror.setValue(null);
      }
      return null; // keep the current session on a transient failure
    }
    return this.toUser();
  }

  // Data-driven plan/limits config. Returns [] if the collection doesn't exist
  // yet (backend built later) or is unreachable — the client then falls back to
  // its bundled defaults. Read-only; no auth beyond what the collection's rule
  // requires (the handoff spec makes `plans` publicly/authed-readable).
  async fetchPlans(): Promise<PlanConfigRow[]> {
    try {
      const rows = await this.req(() => this.pb.collection('plans').getFullList({ sort: 'key' }));
      return rows.map((r: any) => ({
        key: String(r.key ?? ''),
        max_bookmarks: r.max_bookmarks ?? null,
        max_watches: r.max_watches ?? null,
        max_storage_bytes: r.max_storage_bytes ?? null,
        hosted_ai: Boolean(r.hosted_ai),
        ai_credit_allowance: r.ai_credit_allowance ?? null,
        capture_tier: String(r.capture_tier ?? 'basic'),
        stripe_price_month: String(r.stripe_price_month ?? ''),
        stripe_price_year: String(r.stripe_price_year ?? ''),
      }));
    } catch {
      return [];
    }
  }

  // Cross-context auth-change notifications: authMirror already gets written
  // whenever the auth record changes (onChange handler in init()) and watched
  // by every other open context (also in init()) to keep this.pb.authStore in
  // sync. This just re-exposes THAT existing signal to callers (useAuth())
  // that want to re-render on a live plan change — e.g. after a Stripe
  // upgrade lands via the webhook and refreshUser() picks it up.
  watchAuthChange(cb: () => void): () => void {
    return authMirror.watch(() => cb());
  }

  // Stripe billing (Phase 3 client -> PocketBase custom routes). Both simply
  // relay to the backend and return its Stripe-hosted URL; the backend picks
  // test/live secret key + price ids server-side (stripe_mode), and the
  // webhook — never this response — is the source of truth for plan state.
  async createCheckoutSession(plan: 'pro', interval: 'month' | 'year'): Promise<{ url: string }> {
    return this.req(() => this.pb.send(PB_CHECKOUT_ROUTE, { method: 'POST', body: { plan, interval } }), 1);
  }

  async createPortalSession(): Promise<{ url: string }> {
    return this.req(() => this.pb.send(PB_PORTAL_ROUTE, { method: 'POST' }), 1);
  }

  // ── Owner admin (billing config) ─────────────────────────────────────────
  // The `stripe_mode` collection holds ONE row: the test|live flag plus the
  // PUBLIC publishable keys (pk_test/pk_live). Owner-scoped write rules live
  // server-side; this client access is a convenience for the admin panel, not
  // the security boundary. Secret keys never touch this collection.
  async getBillingConfig(): Promise<BillingConfig | null> {
    try {
      const list = await this.req(() => this.pb.collection('stripe_mode').getList(1, 1));
      const rec = list.items[0] as any;
      if (!rec) return null;
      return { mode: rec.mode === 'live' ? 'live' : 'test', pkTest: String(rec.pk_test ?? ''), pkLive: String(rec.pk_live ?? '') };
    } catch {
      return null; // collection missing / not owner — panel degrades gracefully
    }
  }

  async updateBillingConfig(patch: Partial<BillingConfig>): Promise<BillingConfig> {
    const list = await this.req(() => this.pb.collection('stripe_mode').getList(1, 1));
    const rec = list.items[0] as any;
    if (!rec) throw new Error('No stripe_mode config row exists yet — the backend must seed it first.');
    const body: Record<string, unknown> = {};
    if (patch.mode) body.mode = patch.mode;
    if (patch.pkTest !== undefined) body.pk_test = patch.pkTest;
    if (patch.pkLive !== undefined) body.pk_live = patch.pkLive;
    const updated = (await this.req(() => this.pb.collection('stripe_mode').update(rec.id, body))) as any;
    return { mode: updated.mode === 'live' ? 'live' : 'test', pkTest: String(updated.pk_test ?? ''), pkLive: String(updated.pk_live ?? '') };
  }

  async recentBillingEvents(limit = 20): Promise<BillingEvent[]> {
    try {
      const list = await this.req(() => this.pb.collection('webhook_events').getList(1, limit, { sort: '-created' }));
      return list.items.map((r: any) => ({
        id: String(r.event_id ?? r.id ?? ''),
        type: String(r.type ?? ''),
        created: String(r.received_at ?? r.created ?? ''),
        handled: r.handled != null ? Boolean(r.handled) : undefined,
      }));
    } catch {
      return [];
    }
  }

  private toUser(): AuthUser | null {
    const r = this.pb.authStore.record as
      | { id: string; email?: string; name?: string; plan?: string }
      | null;
    if (!r) return null;
    const plan = r.plan === 'owner' || r.plan === 'pro' ? r.plan : 'free';
    return { id: r.id, email: r.email ?? '', name: r.name, plan };
  }

  async login(email: string, password: string): Promise<AuthUser> {
    try {
      await this.pb.collection('users').authWithPassword(email, password);
    } catch (e) {
      throw new Error(authError(e, 'login'));
    }
    return this.toUser()!;
  }

  async signup(email: string, password: string, name?: string): Promise<AuthUser> {
    try {
      await this.pb.collection('users').create({
        email,
        password,
        passwordConfirm: password,
        name: name || email.split('@')[0],
      });
    } catch (e) {
      throw new Error(authError(e, 'signup'));
    }
    return this.login(email, password);
  }

  async logout(): Promise<void> {
    this.pb.authStore.clear();
    await authMirror.setValue(null);
  }

  async requestPasswordReset(email: string): Promise<void> {
    try {
      await this.pb.collection('users').requestPasswordReset(email);
    } catch (e) {
      // Don't reveal whether the email exists; only surface real transport errors.
      const status = (e as { status?: number })?.status;
      if (status === 429) throw new Error('Too many attempts — wait a few seconds and try again.');
      if (!status) throw new Error('Can’t reach the server — check your connection and try again.');
      // 400/404 (unknown email) is treated as success from the UI's side.
    }
  }

  currentUser(): AuthUser | null {
    return this.toUser();
  }
  isLoggedIn(): boolean {
    return this.pb.authStore.isValid;
  }

  private uid(): string {
    const id = this.pb.authStore.record?.id;
    if (!id) throw new Error('Not logged in');
    return id;
  }

  // Every data call goes through here: transient failures (network blip,
  // timeout, 5xx) retry with backoff instead of failing the user's action;
  // a 401 means the session died server-side, so flip every surface to the
  // login form (clearing authStore also clears the cross-context mirror).
  // 4xx errors are real answers and never retried.
  private async req<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const status = (e as { status?: number })?.status ?? 0;
        if (status === 401 && this.pb.authStore.isValid) this.pb.authStore.clear();
        // 429 = rate limited (retry, honoring Retry-After); 0/5xx = transient.
        const transient = status === 0 || status === 429 || status >= 500;
        if (!transient || attempt >= retries) throw e;
        await new Promise((r) => setTimeout(r, this.backoffMs(status, attempt)));
      }
    }
  }

  // Delay before a retry. A fresh 429 waits the server's Retry-After (data
  // endpoints report ≤10s), bounded so the UI never hangs on it; other transient
  // failures use exponential backoff.
  private backoffMs(status: number, attempt: number): number {
    if (status === 429 && this.retryAfterMs > 0 && Date.now() - this.retryAfterAt < 3000) {
      return Math.min(this.retryAfterMs, 12_000) + Math.floor(Math.random() * 250);
    }
    return 400 * Math.pow(3, attempt);
  }

  // Deletes retry like everything else, but a 404 on retry means an earlier
  // attempt actually landed — that is success, not an error.
  private async del(fn: () => Promise<unknown>): Promise<void> {
    try {
      await this.req(fn);
    } catch (e) {
      if ((e as { status?: number })?.status !== 404) throw e;
    }
  }

  fileUrl(record: { id: string; collectionId: string }, filename: string): string {
    return `${this.url}/api/files/${record.collectionId}/${record.id}/${filename}`;
  }

  private normalize = (rec: any): Bookmark => ({
    id: rec.id,
    url: rec.url,
    title: rec.title,
    description: rec.description || undefined,
    summary: rec.summary || undefined,
    content: rec.content || undefined,
    note: rec.note || undefined,
    tags: parseTags(rec.tags),
    aiTags: parseTags(rec.aiTags),
    collection: rec.collection || undefined,
    cover: rec.cover || undefined,
    favicon: rec.favicon || faviconFor(rec.domain || safeDomain(rec.url)),
    screenshot: rec.screenshot ? this.fileUrl(rec, rec.screenshot) : undefined,
    domain: rec.domain || safeDomain(rec.url),
    type: (rec.type as BookmarkType) || inferType(rec.url),
    favorite: Boolean(rec.favorite),
    pinned: Boolean(rec.pinned),
    homeOnly: Boolean(rec.homeOnly),
    sort: typeof rec.sort === 'number' ? rec.sort : undefined,
    readingTime: typeof rec.readingTime === 'number' ? rec.readingTime : undefined,
    broken: Boolean(rec.broken),
    lastVisited: rec.lastVisited || undefined,
    user: rec.user,
    created: rec.created,
    updated: rec.updated,
  });

  async saveBookmark(input: SaveBookmarkInput): Promise<Bookmark> {
    const user = this.uid();
    const domain = input.domain ?? safeDomain(input.url);
    const form = new FormData();
    form.set('url', input.url);
    form.set('title', input.title || input.url);
    form.set('description', input.description ?? '');
    form.set('summary', input.summary ?? '');
    form.set('content', input.content ?? '');
    form.set('note', input.note ?? '');
    form.set('tags', JSON.stringify(input.tags ?? []));
    form.set('aiTags', JSON.stringify(input.aiTags ?? []));
    if (input.collection) form.set('collection', input.collection);
    form.set('domain', domain);
    form.set('type', input.type ?? inferType(input.url));
    form.set('favorite', String(Boolean(input.favorite)));
    form.set('pinned', String(Boolean(input.pinned)));
    form.set('homeOnly', String(Boolean(input.homeOnly)));
    if (typeof input.sort === 'number') form.set('sort', String(input.sort));
    if (input.cover) form.set('cover', input.cover);
    if (input.favicon) form.set('favicon', input.favicon);
    if (typeof input.readingTime === 'number') form.set('readingTime', String(input.readingTime));
    form.set('user', user);
    if (input.screenshotBlob) form.set('screenshot', input.screenshotBlob, `${Date.now()}.jpg`);
    const rec = await this.req(() => this.pb.collection('bookmarks').create(form), 0);
    return this.normalize(rec);
  }

  // Bulk import via the server's atomic /api/batch endpoint: one request per
  // chunk instead of one create per row. A batch is all-or-nothing (a single
  // rejected row rolls the whole chunk back), so on ANY batch failure we fall
  // back to resilient per-item creates for that chunk — a malformed row can't
  // sink the rest of the import. Imported rows are plain library bookmarks with
  // no screenshot file, so JSON bodies are fine.
  async bulkSave(inputs: SaveBookmarkInput[]): Promise<number> {
    const user = this.uid();
    const toBody = (input: SaveBookmarkInput): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        url: input.url,
        title: input.title || input.url,
        description: input.description ?? '',
        summary: input.summary ?? '',
        content: input.content ?? '',
        note: input.note ?? '',
        // Batch bodies are JSON, so json fields take the native array — NOT a
        // stringified string (which the single-save FormData path needs). Sending
        // a string here would double-encode it into the column.
        tags: input.tags ?? [],
        aiTags: input.aiTags ?? [],
        domain: input.domain ?? safeDomain(input.url),
        type: input.type ?? inferType(input.url),
        favorite: Boolean(input.favorite),
        pinned: Boolean(input.pinned),
        homeOnly: Boolean(input.homeOnly),
        user,
      };
      if (input.collection) body.collection = input.collection;
      if (typeof input.sort === 'number') body.sort = input.sort;
      if (input.cover) body.cover = input.cover;
      if (input.favicon) body.favicon = input.favicon;
      if (typeof input.readingTime === 'number') body.readingTime = input.readingTime;
      return body;
    };

    let saved = 0;
    const CHUNK = 100; // server cap is 200/batch; smaller keeps each atomic unit modest
    for (let i = 0; i < inputs.length; i += CHUNK) {
      const slice = inputs.slice(i, i + CHUNK);
      try {
        const batch = this.pb.createBatch();
        for (const input of slice) batch.collection('bookmarks').create(toBody(input));
        const results = await this.req(() => batch.send(), 0);
        saved += results.filter((r) => r.status >= 200 && r.status < 300).length;
      } catch (error) {
        const status = (error as { status?: number })?.status ?? 0;
        // Replay as individual creates only when the server definitively
        // rejected the batch shape. Network/timeout/429/5xx is ambiguous: the
        // atomic batch may have committed, so replaying could duplicate rows.
        if (![400, 404, 405, 422].includes(status)) throw error;
        for (const input of slice) {
          try {
            await this.saveBookmark(input);
            saved++;
          } catch {
            /* skip the row that failed; keep importing the rest */
          }
        }
      }
    }
    return saved;
  }

  async updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark> {
    const body: Record<string, unknown> = {};
    // CRITICAL: JSON.stringify drops undefined values, so "clear this field"
    // (e.g. remove from a collection => collection: undefined) would silently
    // never save. Convert explicit undefined to '' so PocketBase clears it.
    for (const [k, v] of Object.entries(patch)) {
      body[k] = v === undefined ? '' : v;
    }
    if (patch.tags) body.tags = JSON.stringify(patch.tags);
    if (patch.aiTags) body.aiTags = JSON.stringify(patch.aiTags);
    const rec = await this.req(() => this.pb.collection('bookmarks').update(id, body));
    return this.normalize(rec);
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.del(() => this.pb.collection('bookmarks').delete(id));
  }

  async searchBookmarks(query: string, opts: SearchOpts = {}): Promise<Bookmark[]> {
    const user = this.uid();
    const filters: string[] = [`user = "${user}"`];
    if (query.trim()) {
      const q = escFilter(query);
      filters.push(
        `(title ~ "${q}" || url ~ "${q}" || description ~ "${q}" || summary ~ "${q}" || note ~ "${q}" || tags ~ "${q}")`,
      );
    }
    if (opts.collection) filters.push(`collection = "${escFilter(opts.collection)}"`);
    if (opts.tag) filters.push(`tags ~ "${escFilter(opts.tag)}"`);
    if (opts.type) filters.push(`type = "${escFilter(opts.type)}"`);
    if (opts.favorite) filters.push('favorite = true');
    if (opts.untagged) filters.push('tags = "[]"');
    // Home fast-path: only launcher rows, and drop the heavy `content` column
    // (cached full-page text) from the wire — nothing on Home reads it.
    if (opts.home) filters.push('(pinned = true || homeOnly = true)');
    const listOpts: Record<string, unknown> = {
      filter: filters.join(' && '),
      sort: SORT_FILTER[opts.sort ?? 'newest'],
    };
    if (opts.home) listOpts.fields = HOME_TILE_FIELDS;
    const list = await this.req(() => this.pb.collection('bookmarks').getList(opts.page ?? 1, opts.perPage ?? 60, listOpts));
    return list.items.map(this.normalize);
  }

  async findByUrl(url: string): Promise<Bookmark | null> {
    try {
      const rec = await this.req(() =>
        this.pb.collection('bookmarks').getFirstListItem(`user = "${this.uid()}" && url = "${escFilter(url)}"`),
      );
      return this.normalize(rec);
    } catch (error) {
      if ((error as { status?: number })?.status === 404) return null;
      throw error;
    }
  }

  async markVisited(id: string): Promise<void> {
    try {
      await this.req(() => this.pb.collection('bookmarks').update(id, { lastVisited: new Date().toISOString() }), 0);
    } catch {
      /* non-critical */
    }
  }

  async getAllTags(): Promise<{ tag: string; count: number }[]> {
    const items = await this.req(() =>
      this.pb.collection('bookmarks').getFullList({ filter: `user = "${this.uid()}"`, fields: 'tags' }),
    );
    const counts = new Map<string, number>();
    for (const it of items) for (const t of parseTags((it as any).tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }

  async countByCollection(): Promise<Record<string, number>> {
    const items = await this.req(() =>
      this.pb.collection('bookmarks').getFullList({ filter: `user = "${this.uid()}"`, fields: 'collection' }),
    );
    const counts: Record<string, number> = {};
    for (const it of items) {
      const c = (it as any).collection;
      if (c) counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }

  async vaultStats(): Promise<VaultStats> {
    const filter = `user = "${this.uid()}"`;
    const [bms, cols, hls, tags, favs] = await Promise.all([
      this.req(() => this.pb.collection('bookmarks').getList(1, 1, { filter })),
      this.req(() => this.pb.collection('collections').getList(1, 1, { filter })),
      this.req(() => this.pb.collection('highlights').getList(1, 1, { filter })).catch(() => ({ totalItems: 0 })),
      this.getAllTags(),
      this.req(() => this.pb.collection('bookmarks').getList(1, 1, { filter: `${filter} && favorite = true` })).catch(
        () => ({ totalItems: 0 }),
      ),
    ]);
    return {
      total: bms.totalItems,
      collections: cols.totalItems,
      tags: tags.length,
      highlights: (hls as any).totalItems,
      favorites: (favs as any).totalItems,
    };
  }

  async listCollections(): Promise<Collection[]> {
    const list = await this.req(() =>
      this.pb.collection('collections').getFullList({ filter: `user = "${this.uid()}"`, sort: 'sort,name' }),
    );
    return list as unknown as Collection[];
  }

  async createCollection(data: {
    name: string;
    color?: string;
    icon?: string;
    parent?: string;
  }): Promise<Collection> {
    const rec = await this.req(() => this.pb.collection('collections').create({ ...data, user: this.uid() }), 0);
    return rec as unknown as Collection;
  }

  async updateCollection(id: string, patch: Partial<Collection>): Promise<Collection> {
    // Same undefined→'' conversion as updateBookmark: JSON.stringify drops
    // undefined, so "clear parent/color/icon" would otherwise silently no-op.
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) body[k] = v === undefined ? '' : v;
    const rec = await this.req(() => this.pb.collection('collections').update(id, body));
    return rec as unknown as Collection;
  }

  async deleteCollection(id: string): Promise<void> {
    const inside = await this.searchBookmarks('', { collection: id, perPage: 200 });
    await Promise.all(inside.map((b) => this.updateBookmark(b.id, { collection: undefined })));
    await this.del(() => this.pb.collection('collections').delete(id));
  }

  async createHighlight(input: CreateHighlightInput): Promise<Highlight> {
    const rec = await this.req(
      () =>
        this.pb.collection('highlights').create({
          url: input.url,
          text: input.text,
          color: input.color ?? 'yellow',
          note: input.note ?? '',
          bookmark: input.bookmark,
          anchor: input.anchor ? JSON.stringify(input.anchor) : '',
          user: this.uid(),
        }),
      0,
    );
    return this.normalizeHighlight(rec);
  }

  async highlightsForUrl(url: string): Promise<Highlight[]> {
    const list = await this.req(() =>
      this.pb.collection('highlights').getFullList({
        filter: `user = "${this.uid()}" && url = "${escFilter(url)}"`,
        sort: 'created',
      }),
    );
    return list.map(this.normalizeHighlight);
  }

  async allHighlights(limit = 200): Promise<Highlight[]> {
    const list = await this.req(() =>
      this.pb.collection('highlights').getList(1, limit, { filter: `user = "${this.uid()}"`, sort: '-created' }),
    );
    return list.items.map(this.normalizeHighlight);
  }

  async deleteHighlight(id: string): Promise<void> {
    await this.del(() => this.pb.collection('highlights').delete(id));
  }

  async updateHighlight(id: string, patch: { note?: string; color?: HighlightColor }): Promise<void> {
    await this.req(() => this.pb.collection('highlights').update(id, patch));
  }

  private normalizeHighlight = (rec: any): Highlight => ({
    id: rec.id,
    bookmark: rec.bookmark || undefined,
    url: rec.url,
    text: rec.text,
    note: rec.note || undefined,
    color: (rec.color as HighlightColor) || 'yellow',
    anchor: rec.anchor || undefined,
    user: rec.user,
    created: rec.created,
    updated: rec.updated,
  });
}
