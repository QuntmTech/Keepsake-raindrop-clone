import { saveBookmark } from './bookmarks';
import { captureTier, storageRemaining } from './entitlements';
import { emptySave, patchSave, putBlob, putSave, type SaveType } from './save';
import { safeDomain } from './util';

export interface CaptureSaveResult {
  saveId: string;
  cloudSaved: boolean; // false => kept as a local-only Save (plan limit or offline)
}

// Phase-0 capture unification: every screenshot/recording becomes a Save in
// the library, not just a file in Downloads. The vault record makes it show up
// in the normal library UI; the media blob lives in IndexedDB next to the Save.
//
// Plan gating (guardrail only — PocketBase is the authoritative enforcer):
// recordings only sync to the cloud vault on the 'full' capture tier (Pro);
// on Free they're kept as a local-only Save so download/copy/edit in the
// Capture Studio ALWAYS works — only the cross-device library sync is gated.
// Both tiers additionally back off to local-only if the estimated cloud
// storage cap is already exceeded.
export async function saveCaptureToLibrary(opts: {
  kind: Extract<SaveType, 'screenshot' | 'recording'>;
  blob: Blob;
  pageUrl?: string;
  pageTitle?: string;
  filename: string;
  durationMs?: number;
}): Promise<CaptureSaveResult> {
  const when = new Date().toLocaleString();
  const label = opts.kind === 'screenshot' ? 'Screenshot' : 'Recording';
  const title = `${label} — ${opts.pageTitle || when}`;
  const url = opts.pageUrl && /^https?:/i.test(opts.pageUrl) ? opts.pageUrl : `https://keepsake.capture/${encodeURIComponent(opts.filename)}`;

  const [tier, storage] = await Promise.all([captureTier(), storageRemaining()]);
  // Recordings need the 'full' tier to sync at all; screenshots always may
  // (they're core save behavior), but both back off once storage is tight.
  const overCap = !storage.unlimited && storage.remaining !== null && storage.remaining <= opts.blob.size;
  const allowCloud = (opts.kind === 'screenshot' || tier === 'full') && !overCap;

  let saveId: string;
  let cloudSaved = false;
  if (allowCloud) {
    try {
      // Normal path: a vault bookmark (syncs, renders in the library) + sidecar.
      const bm = await saveBookmark({
        url,
        title,
        description:
          opts.kind === 'recording'
            ? `Screen recording (${Math.round((opts.durationMs ?? 0) / 1000)}s) — saved to Downloads/${opts.filename}`
            : `Screenshot — saved to Downloads/${opts.filename}`,
        tags: ['capture'],
        type: opts.kind === 'recording' ? 'video' : 'image',
        domain: safeDomain(url),
      });
      saveId = bm.id;
      cloudSaved = true;
    } catch {
      // Offline / logged out: keep the capture as a local-only Save.
      const s = emptySave({ url, title });
      s.type = opts.kind;
      await putSave(s);
      saveId = s.id;
    }
  } else {
    // Plan limit (Free recording, or over the storage cap): local-only Save.
    // Downloads/copy/edit in the Capture Studio work identically either way —
    // only cross-device cloud sync is withheld.
    const s = emptySave({ url, title });
    s.type = opts.kind;
    await putSave(s);
    saveId = s.id;
  }

  const ref = await putBlob(saveId, opts.kind, opts.blob);
  await patchSave(saveId, (s) => {
    s.type = opts.kind;
    s.archive.snapshotRef = ref;
    // Extraction hooks land in a later phase — explicit nulls per the schema.
    if (opts.kind === 'screenshot') s.content.ocrText = null;
    else s.content.transcript = null;
  });
  return { saveId, cloudSaved };
}
