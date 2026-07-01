import { storage } from 'wxt/utils/storage';
import { getBackend } from './backend';
import { type Bookmark } from './types';
import { type SaveBookmarkInput } from './backend/types';

// Home-tile fields with a write-through fallback.
//
// Home depends on three bookmark fields: `pinned` (show on Home), `sort`
// (tile order) and `homeOnly` (catalog tiles that must NOT appear in the
// library). PocketBase silently ignores fields its schema doesn't have, so on
// a server imported from an older schema a save can "succeed" while dropping
// them — the add toast fires but the tile never reaches Home. Every write
// here verifies the round-trip; fields the server dropped are persisted in an
// extension-storage overlay keyed by user, and merged back in on every read.
// Once the server schema is migrated the overlay self-heals: verified writes
// clear their entries, and syncHomeOverlay() flushes the rest.

export interface HomeFields {
  pinned?: boolean;
  sort?: number;
  homeOnly?: boolean;
}

const HOME_FIELDS = ['pinned', 'sort', 'homeOnly'] as const;

type Overlay = Record<string, Record<string, HomeFields>>; // uid -> bookmark id -> fields

const overlayStore = storage.defineItem<Overlay>('local:home_overlay', { fallback: {} });

async function uid(): Promise<string | null> {
  return (await getBackend()).currentUser()?.id ?? null;
}

function pickDropped(requested: HomeFields, result: Bookmark): HomeFields {
  const dropped: HomeFields = {};
  for (const k of HOME_FIELDS) {
    if (requested[k] === undefined) continue;
    const want = k === 'sort' ? requested[k] : Boolean(requested[k]);
    const got = k === 'sort' ? result[k] : Boolean((result as any)[k]);
    if (want !== got) (dropped as any)[k] = requested[k];
  }
  return dropped;
}

// All overlay mutations are serialized through this chain: drag-drop and
// bulk operations fire many updateBookmark calls in parallel, and an unlocked
// read-modify-write here would let last-writer-wins silently drop sibling
// tiles' pin/sort entries (the exact data this overlay exists to protect).
let overlayWriteLock: Promise<unknown> = Promise.resolve();

function writeOverlay(user: string, id: string, dropped: HomeFields, verified: (keyof HomeFields)[]) {
  const run = overlayWriteLock.then(async () => {
    const all = await overlayStore.getValue();
    const mine = { ...(all[user] ?? {}) };
    const entry: HomeFields = { ...(mine[id] ?? {}) };
    for (const k of verified) delete entry[k]; // server round-tripped it — server wins now
    Object.assign(entry, dropped);
    if (Object.keys(entry).length) mine[id] = entry;
    else delete mine[id];
    await overlayStore.setValue({ ...all, [user]: mine });
  });
  overlayWriteLock = run.catch(() => {}); // a failed write must not poison the chain
  return run;
}

// Merge overlay values over freshly-fetched bookmarks. Server values win only
// where no overlay entry exists (an entry means the server dropped the field).
export async function applyHomeOverlay(items: Bookmark[]): Promise<Bookmark[]> {
  const user = await uid();
  if (!user) return items;
  const mine = (await overlayStore.getValue())[user];
  if (!mine || !Object.keys(mine).length) return items;
  return items.map((b) => (mine[b.id] ? { ...b, ...mine[b.id] } : b));
}

// Save a bookmark that must carry Home fields; falls back to the overlay for
// anything the server dropped. Only resolves once the tile is durably stored,
// so a success toast after this IS truthful.
export async function saveHomeBookmark(input: SaveBookmarkInput & HomeFields): Promise<Bookmark> {
  const backend = await getBackend();
  const bm = await backend.saveBookmark(input);
  const requested: HomeFields = { pinned: input.pinned, sort: input.sort, homeOnly: input.homeOnly };
  const dropped = pickDropped(requested, bm);
  if (Object.keys(dropped).length) {
    const user = await uid();
    if (!user) throw new Error('Not logged in');
    await writeOverlay(user, bm.id, dropped, []);
  }
  return (await applyHomeOverlay([bm]))[0];
}

// Patch a bookmark, verifying Home fields round-tripped; dropped ones go to
// the overlay, verified ones clear any stale overlay entry.
export async function updateHomeBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark> {
  const backend = await getBackend();
  const bm = await backend.updateBookmark(id, patch);
  const requested: HomeFields = { pinned: patch.pinned, sort: patch.sort, homeOnly: patch.homeOnly };
  const dropped = pickDropped(requested, bm);
  const verified = HOME_FIELDS.filter((k) => requested[k] !== undefined && !(k in dropped));
  const user = await uid();
  if (user && (Object.keys(dropped).length || verified.length)) {
    await writeOverlay(user, id, dropped, verified);
  }
  return (await applyHomeOverlay([bm]))[0];
}

// Drop a deleted bookmark's overlay entry so it can't resurrect.
export async function forgetHomeOverlay(id: string): Promise<void> {
  const user = await uid();
  if (!user) return;
  const all = await overlayStore.getValue();
  if (!all[user]?.[id]) return;
  const mine = { ...all[user] };
  delete mine[id];
  await overlayStore.setValue({ ...all, [user]: mine });
}

// Best-effort flush: retry pushing overlay entries to the server (e.g. after
// the schema gets migrated). Entries that round-trip are cleared; entries
// whose bookmark is gone are dropped. Safe to call on every Home open.
let syncing = false;
export async function syncHomeOverlay(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const user = await uid();
    if (!user) return;
    const mine = (await overlayStore.getValue())[user];
    if (!mine) return;
    for (const [id, fields] of Object.entries(mine)) {
      try {
        await updateHomeBookmark(id, fields);
      } catch (e) {
        // Only drop the entry when the bookmark itself is gone; keep it on
        // transient failures (offline, 5xx) so pin state is never lost.
        const status = (e as { status?: number })?.status;
        const gone = status === 404 || /not found/i.test((e as Error)?.message ?? '');
        if (gone) await forgetHomeOverlay(id);
      }
    }
  } finally {
    syncing = false;
  }
}

// Notify when the overlay changes in another context (popup pins something
// while a Home tab is open) so Home can refresh.
export function watchHomeOverlay(cb: () => void): () => void {
  return overlayStore.watch(() => cb());
}
