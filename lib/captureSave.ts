import { saveBookmark } from './bookmarks';
import { emptySave, patchSave, putBlob, putSave, type SaveType } from './save';
import { safeDomain } from './util';

// Phase-0 capture unification: every screenshot/recording becomes a Save in
// the library, not just a file in Downloads. The vault record makes it show up
// in the normal library UI; the media blob lives in IndexedDB next to the Save.

export async function saveCaptureToLibrary(opts: {
  kind: Extract<SaveType, 'screenshot' | 'recording'>;
  blob: Blob;
  pageUrl?: string;
  pageTitle?: string;
  filename: string;
  durationMs?: number;
}): Promise<void> {
  const when = new Date().toLocaleString();
  const label = opts.kind === 'screenshot' ? 'Screenshot' : 'Recording';
  const title = `${label} — ${opts.pageTitle || when}`;
  const url = opts.pageUrl && /^https?:/i.test(opts.pageUrl) ? opts.pageUrl : `https://keepsake.capture/${encodeURIComponent(opts.filename)}`;

  let saveId: string;
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
  } catch {
    // Offline / logged out: keep the capture as a local-only Save.
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
}
