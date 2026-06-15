import { storage } from 'wxt/utils/storage';
import {
  type Bookmark,
  type Collection,
  type Highlight,
  type HighlightColor,
  type VaultStats,
} from '../types';
import {
  compareBy,
  faviconFor,
  genId,
  inferType,
  nowIso,
  safeDomain,
} from '../util';
import {
  type AuthUser,
  type Backend,
  type CreateHighlightInput,
  type SaveBookmarkInput,
  type SearchOpts,
} from './types';

// Fully local, zero-dependency backend backed by chrome.storage.local.
// Lets the entire extension work end-to-end (accounts, bookmarks, collections,
// highlights, search) with NO external server. Swap to PocketBase later by
// flipping the backend mode in Settings.

interface StoredUser {
  id: string;
  email: string;
  name?: string;
  salt: string;
  hash: string;
  created: string;
}

const usersStore = storage.defineItem<StoredUser[]>('local:users', { fallback: [] });
const sessionStore = storage.defineItem<string | null>('local:session', { fallback: null });
const bookmarksStore = storage.defineItem<Bookmark[]>('local:bookmarks', { fallback: [] });
const collectionsStore = storage.defineItem<Collection[]>('local:collections', { fallback: [] });
const highlightsStore = storage.defineItem<Highlight[]>('local:highlights', { fallback: [] });

// Wipe all locally-stored bookmarks, collections, and highlights (keeps the
// account). Used by Settings → "Clear local data" in local mode.
export async function clearLocalData(): Promise<void> {
  await bookmarksStore.setValue([]);
  await collectionsStore.setValue([]);
  await highlightsStore.setValue([]);
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

export class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  private user: AuthUser | null = null;
  private wired = false;

  async init(): Promise<void> {
    await this.refreshSession();
    // Stay in sync when auth changes in ANOTHER context (e.g. you log in via the
    // popup while a page — and its content-script Quick Bar — is already open).
    if (!this.wired) {
      this.wired = true;
      sessionStore.watch(() => this.refreshSession());
    }
  }

  private async refreshSession(): Promise<void> {
    const uid = await sessionStore.getValue();
    if (!uid) {
      this.user = null;
      return;
    }
    const users = await usersStore.getValue();
    const u = users.find((x) => x.id === uid);
    this.user = u ? { id: u.id, email: u.email, name: u.name } : null;
  }

  // ---- auth ----
  async signup(email: string, password: string, name?: string): Promise<AuthUser> {
    email = email.trim().toLowerCase();
    if (!email || !password) throw new Error('Email and password are required');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    const users = await usersStore.getValue();
    if (users.some((u) => u.email === email)) throw new Error('An account with this email already exists');
    const salt = genId();
    const hash = await sha256(salt + password);
    const user: StoredUser = {
      id: genId(),
      email,
      name: name || email.split('@')[0],
      salt,
      hash,
      created: nowIso(),
    };
    await usersStore.setValue([...users, user]);
    await sessionStore.setValue(user.id);
    this.user = { id: user.id, email: user.email, name: user.name };
    return this.user;
  }

  async login(email: string, password: string): Promise<AuthUser> {
    email = email.trim().toLowerCase();
    const users = await usersStore.getValue();
    const u = users.find((x) => x.email === email);
    if (!u) throw new Error('No account found for that email');
    const hash = await sha256(u.salt + password);
    if (hash !== u.hash) throw new Error('Incorrect password');
    await sessionStore.setValue(u.id);
    this.user = { id: u.id, email: u.email, name: u.name };
    return this.user;
  }

  async logout(): Promise<void> {
    await sessionStore.setValue(null);
    this.user = null;
  }

  currentUser(): AuthUser | null {
    return this.user;
  }
  isLoggedIn(): boolean {
    return this.user !== null;
  }

  // Notify open UIs whenever the vault changes (in any context).
  watch(cb: () => void): () => void {
    const u1 = bookmarksStore.watch(() => cb());
    const u2 = collectionsStore.watch(() => cb());
    const u3 = highlightsStore.watch(() => cb());
    return () => {
      u1();
      u2();
      u3();
    };
  }

  private uid(): string {
    if (!this.user) throw new Error('Not logged in');
    return this.user.id;
  }

  // ---- bookmarks ----
  private async mine(): Promise<Bookmark[]> {
    const all = await bookmarksStore.getValue();
    return all.filter((b) => b.user === this.uid());
  }

  async saveBookmark(input: SaveBookmarkInput): Promise<Bookmark> {
    const uid = this.uid();
    const domain = input.domain ?? safeDomain(input.url);
    let screenshot: string | undefined;
    if (input.screenshotBlob) {
      try {
        screenshot = await blobToDataUrl(input.screenshotBlob);
      } catch {
        /* skip preview */
      }
    }
    const bm: Bookmark = {
      id: genId(),
      url: input.url,
      title: input.title || input.url,
      description: input.description,
      summary: input.summary,
      content: input.content,
      note: input.note,
      tags: input.tags ?? [],
      aiTags: input.aiTags ?? [],
      collection: input.collection,
      cover: input.cover,
      favicon: input.favicon ?? faviconFor(domain),
      screenshot,
      domain,
      type: input.type ?? inferType(input.url),
      favorite: Boolean(input.favorite),
      readingTime: input.readingTime,
      user: uid,
      created: nowIso(),
      updated: nowIso(),
    };
    const all = await bookmarksStore.getValue();
    await bookmarksStore.setValue([bm, ...all]);
    return bm;
  }

  // Bulk import: build all records and write the store once (fast for big files).
  async bulkSave(inputs: SaveBookmarkInput[]): Promise<number> {
    const uid = this.uid();
    const all = await bookmarksStore.getValue();
    const now = nowIso();
    const existing = new Set(all.filter((b) => b.user === uid).map((b) => b.url));
    const recs: Bookmark[] = [];
    for (const input of inputs) {
      if (existing.has(input.url)) continue; // skip duplicates already in the vault
      existing.add(input.url);
      const domain = input.domain ?? safeDomain(input.url);
      recs.push({
        id: genId(),
        url: input.url,
        title: input.title || input.url,
        description: input.description,
        summary: input.summary,
        note: input.note,
        tags: input.tags ?? [],
        aiTags: input.aiTags ?? [],
        collection: input.collection,
        cover: input.cover,
        favicon: input.favicon ?? faviconFor(domain),
        domain,
        type: input.type ?? inferType(input.url),
        favorite: Boolean(input.favorite),
        readingTime: input.readingTime,
        user: uid,
        created: now,
        updated: now,
      });
    }
    await bookmarksStore.setValue([...recs, ...all]);
    return recs.length;
  }

  async updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark> {
    const all = await bookmarksStore.getValue();
    let updated: Bookmark | undefined;
    const next = all.map((b) => {
      if (b.id === id && b.user === this.uid()) {
        updated = { ...b, ...patch, updated: nowIso() };
        return updated;
      }
      return b;
    });
    if (!updated) throw new Error('Bookmark not found');
    await bookmarksStore.setValue(next);
    return updated;
  }

  async deleteBookmark(id: string): Promise<void> {
    const all = await bookmarksStore.getValue();
    await bookmarksStore.setValue(all.filter((b) => !(b.id === id && b.user === this.uid())));
  }

  async searchBookmarks(query: string, opts: SearchOpts = {}): Promise<Bookmark[]> {
    let items = await this.mine();
    const q = query.trim().toLowerCase();
    if (q) {
      items = items.filter((b) =>
        [b.title, b.url, b.description, b.summary, b.note, ...(b.tags ?? [])]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q)),
      );
    }
    if (opts.collection) items = items.filter((b) => b.collection === opts.collection);
    if (opts.tag) items = items.filter((b) => b.tags?.includes(opts.tag!));
    if (opts.type) items = items.filter((b) => b.type === opts.type);
    if (opts.favorite) items = items.filter((b) => b.favorite);
    if (opts.untagged) items = items.filter((b) => !b.tags || b.tags.length === 0);

    items.sort(compareBy(opts.sort ?? 'newest'));

    const perPage = opts.perPage ?? 60;
    const page = opts.page ?? 1;
    return items.slice((page - 1) * perPage, page * perPage);
  }

  async findByUrl(url: string): Promise<Bookmark | null> {
    const items = await this.mine();
    return items.find((b) => b.url === url) ?? null;
  }

  async markVisited(id: string): Promise<void> {
    try {
      await this.updateBookmark(id, { lastVisited: nowIso() });
    } catch {
      /* non-critical */
    }
  }

  async getAllTags(): Promise<{ tag: string; count: number }[]> {
    const items = await this.mine();
    const counts = new Map<string, number>();
    for (const b of items) for (const t of b.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  async countByCollection(): Promise<Record<string, number>> {
    const items = await this.mine();
    const counts: Record<string, number> = {};
    for (const b of items) if (b.collection) counts[b.collection] = (counts[b.collection] ?? 0) + 1;
    return counts;
  }

  async vaultStats(): Promise<VaultStats> {
    const [items, cols, hls, tags] = await Promise.all([
      this.mine(),
      this.listCollections(),
      this.allHighlights(9999),
      this.getAllTags(),
    ]);
    return {
      total: items.length,
      collections: cols.length,
      tags: tags.length,
      highlights: hls.length,
      favorites: items.filter((b) => b.favorite).length,
    };
  }

  // ---- collections ----
  async listCollections(): Promise<Collection[]> {
    const all = await collectionsStore.getValue();
    return all
      .filter((c) => c.user === this.uid())
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
  }

  async createCollection(data: {
    name: string;
    color?: string;
    icon?: string;
    parent?: string;
  }): Promise<Collection> {
    const c: Collection = {
      id: genId(),
      name: data.name,
      color: data.color,
      icon: data.icon,
      parent: data.parent,
      user: this.uid(),
      created: nowIso(),
      updated: nowIso(),
    };
    const all = await collectionsStore.getValue();
    await collectionsStore.setValue([...all, c]);
    return c;
  }

  async updateCollection(id: string, patch: Partial<Collection>): Promise<Collection> {
    const all = await collectionsStore.getValue();
    let updated: Collection | undefined;
    const next = all.map((c) => {
      if (c.id === id && c.user === this.uid()) {
        updated = { ...c, ...patch, updated: nowIso() };
        return updated;
      }
      return c;
    });
    if (!updated) throw new Error('Collection not found');
    await collectionsStore.setValue(next);
    return updated;
  }

  async deleteCollection(id: string): Promise<void> {
    // Detach bookmarks (keep them), then drop the collection.
    const bms = await bookmarksStore.getValue();
    await bookmarksStore.setValue(
      bms.map((b) => (b.collection === id ? { ...b, collection: undefined } : b)),
    );
    const all = await collectionsStore.getValue();
    await collectionsStore.setValue(all.filter((c) => !(c.id === id && c.user === this.uid())));
  }

  // ---- highlights ----
  async createHighlight(input: CreateHighlightInput): Promise<Highlight> {
    const h: Highlight = {
      id: genId(),
      bookmark: input.bookmark,
      url: input.url,
      text: input.text,
      note: input.note,
      color: input.color ?? 'yellow',
      anchor: input.anchor ? JSON.stringify(input.anchor) : undefined,
      user: this.uid(),
      created: nowIso(),
      updated: nowIso(),
    };
    const all = await highlightsStore.getValue();
    await highlightsStore.setValue([...all, h]);
    return h;
  }

  async highlightsForUrl(url: string): Promise<Highlight[]> {
    const all = await highlightsStore.getValue();
    return all.filter((h) => h.user === this.uid() && h.url === url);
  }

  async allHighlights(limit = 200): Promise<Highlight[]> {
    const all = await highlightsStore.getValue();
    return all
      .filter((h) => h.user === this.uid())
      .sort((a, b) => b.created.localeCompare(a.created))
      .slice(0, limit);
  }

  async deleteHighlight(id: string): Promise<void> {
    const all = await highlightsStore.getValue();
    await highlightsStore.setValue(all.filter((h) => !(h.id === id && h.user === this.uid())));
  }

  async updateHighlight(id: string, patch: { note?: string; color?: HighlightColor }): Promise<void> {
    const all = await highlightsStore.getValue();
    await highlightsStore.setValue(
      all.map((h) => (h.id === id && h.user === this.uid() ? { ...h, ...patch, updated: nowIso() } : h)),
    );
  }
}
