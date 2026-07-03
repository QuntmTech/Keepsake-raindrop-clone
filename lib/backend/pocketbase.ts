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
import { HOSTED_PB_URL } from '../config';
import {
  type AuthUser,
  type Backend,
  type CreateHighlightInput,
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

  async init(): Promise<void> {
    // Never fall back to localhost in a hosted build — use the baked-in server.
    this.url = (await pbUrlStore.getValue()) || HOSTED_PB_URL || 'http://127.0.0.1:8090';
    this.pb = new PocketBase(this.url);
    // CRITICAL: the SDK auto-cancels duplicate in-flight requests by default,
    // which makes concurrent list/search calls (collections + bookmarks +
    // counts on open) reject as "autocancelled" and show up empty until a later
    // request lands. Turn it off so every request completes.
    this.pb.autoCancellation(false);

    const saved = await authMirror.getValue();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.pb.authStore.save(parsed.token, parsed.record);
      } catch {
        await authMirror.setValue(null);
      }
    }
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
    const rec = await this.pb.collection('bookmarks').create(form);
    return this.normalize(rec);
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
    const rec = await this.pb.collection('bookmarks').update(id, body);
    return this.normalize(rec);
  }

  async deleteBookmark(id: string): Promise<void> {
    await this.pb.collection('bookmarks').delete(id);
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
    const list = await this.pb.collection('bookmarks').getList(opts.page ?? 1, opts.perPage ?? 60, {
      filter: filters.join(' && '),
      sort: SORT_FILTER[opts.sort ?? 'newest'],
    });
    return list.items.map(this.normalize);
  }

  async findByUrl(url: string): Promise<Bookmark | null> {
    try {
      const rec = await this.pb
        .collection('bookmarks')
        .getFirstListItem(`user = "${this.uid()}" && url = "${escFilter(url)}"`);
      return this.normalize(rec);
    } catch {
      return null;
    }
  }

  async markVisited(id: string): Promise<void> {
    try {
      await this.pb.collection('bookmarks').update(id, { lastVisited: new Date().toISOString() });
    } catch {
      /* non-critical */
    }
  }

  async getAllTags(): Promise<{ tag: string; count: number }[]> {
    const items = await this.pb
      .collection('bookmarks')
      .getFullList({ filter: `user = "${this.uid()}"`, fields: 'tags' });
    const counts = new Map<string, number>();
    for (const it of items) for (const t of parseTags((it as any).tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }

  async countByCollection(): Promise<Record<string, number>> {
    const items = await this.pb
      .collection('bookmarks')
      .getFullList({ filter: `user = "${this.uid()}"`, fields: 'collection' });
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
      this.pb.collection('bookmarks').getList(1, 1, { filter }),
      this.pb.collection('collections').getList(1, 1, { filter }),
      this.pb.collection('highlights').getList(1, 1, { filter }).catch(() => ({ totalItems: 0 })),
      this.getAllTags(),
      this.pb
        .collection('bookmarks')
        .getList(1, 1, { filter: `${filter} && favorite = true` })
        .catch(() => ({ totalItems: 0 })),
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
    const list = await this.pb
      .collection('collections')
      .getFullList({ filter: `user = "${this.uid()}"`, sort: 'sort,name' });
    return list as unknown as Collection[];
  }

  async createCollection(data: {
    name: string;
    color?: string;
    icon?: string;
    parent?: string;
  }): Promise<Collection> {
    const rec = await this.pb.collection('collections').create({ ...data, user: this.uid() });
    return rec as unknown as Collection;
  }

  async updateCollection(id: string, patch: Partial<Collection>): Promise<Collection> {
    // Same undefined→'' conversion as updateBookmark: JSON.stringify drops
    // undefined, so "clear parent/color/icon" would otherwise silently no-op.
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) body[k] = v === undefined ? '' : v;
    const rec = await this.pb.collection('collections').update(id, body);
    return rec as unknown as Collection;
  }

  async deleteCollection(id: string): Promise<void> {
    const inside = await this.searchBookmarks('', { collection: id, perPage: 200 });
    await Promise.all(inside.map((b) => this.updateBookmark(b.id, { collection: undefined })));
    await this.pb.collection('collections').delete(id);
  }

  async createHighlight(input: CreateHighlightInput): Promise<Highlight> {
    const rec = await this.pb.collection('highlights').create({
      url: input.url,
      text: input.text,
      color: input.color ?? 'yellow',
      note: input.note ?? '',
      bookmark: input.bookmark,
      anchor: input.anchor ? JSON.stringify(input.anchor) : '',
      user: this.uid(),
    });
    return this.normalizeHighlight(rec);
  }

  async highlightsForUrl(url: string): Promise<Highlight[]> {
    const list = await this.pb.collection('highlights').getFullList({
      filter: `user = "${this.uid()}" && url = "${escFilter(url)}"`,
      sort: 'created',
    });
    return list.map(this.normalizeHighlight);
  }

  async allHighlights(limit = 200): Promise<Highlight[]> {
    const list = await this.pb
      .collection('highlights')
      .getList(1, limit, { filter: `user = "${this.uid()}"`, sort: '-created' });
    return list.items.map(this.normalizeHighlight);
  }

  async deleteHighlight(id: string): Promise<void> {
    await this.pb.collection('highlights').delete(id);
  }

  async updateHighlight(id: string, patch: { note?: string; color?: HighlightColor }): Promise<void> {
    await this.pb.collection('highlights').update(id, patch);
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
