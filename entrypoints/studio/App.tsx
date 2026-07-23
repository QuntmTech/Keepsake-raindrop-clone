import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { getStudioItem, putBlob, updateStudioItem, type StudioItem } from '@/lib/save';
import { saveCaptureToLibrary } from '@/lib/captureSave';
import { ImageEditor, type ImageEditorHandle } from './ImageEditor';
import { VideoStudio, type VideoStudioHandle } from './VideoStudio';

// Capture Studio — every screenshot and recording opens here right after
// capture. Screenshots get a full-resolution annotate/crop editor; recordings
// get a preview player with trim. Export never uses the scaled screen preview.
export default function App() {
  const { toast } = useToast();
  const [item, setItem] = useState<StudioItem | null | undefined>(undefined);
  const [base, setBase] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState('');
  const imgRef = useRef<ImageEditorHandle>(null);
  const vidRef = useRef<VideoStudioHandle>(null);

  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return setItem(null);
    getStudioItem(id).then(async (next) => {
      setItem(next ?? null);
      if (!next) return;
      const name = next.filename.split('/').pop() ?? next.filename;
      setBase(name.replace(/\.[a-z0-9]+$/i, ''));
      setSaved(Boolean(next.saveId));
      const megabytes = next.blob.size / (1024 * 1024);
      if (next.kind === 'screenshot') {
        if (next.width && next.height) {
          const megapixels = (next.width * next.height) / 1_000_000;
          setMediaInfo(`${next.width.toLocaleString()} × ${next.height.toLocaleString()} px · ${megapixels.toFixed(1)} MP · ${megabytes.toFixed(1)} MB`);
        } else {
          // Older parked captures have no dimensions. Do not decode the giant
          // bitmap a second time just for a label; the editor owns the one decode.
          setMediaInfo(`${megabytes.toFixed(1)} MB · ${next.blob.type || 'image'}`);
        }
      } else {
        const seconds = Math.max(0, Math.round((next.durationMs ?? 0) / 1000));
        const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        setMediaInfo(`${duration} · ${megabytes.toFixed(1)} MB · ${next.blob.type || 'video/webm'}`);
      }
    });
  }, []);

  const ext = item ? (item.filename.match(/\.[a-z0-9]+$/i)?.[0] ?? (item.kind === 'recording' ? '.webm' : '.png')) : '';
  const isImage = item?.kind === 'screenshot';

  const exportBlob = useCallback(async (forcePng = false): Promise<Blob> => {
    if (isImage) return imgRef.current!.exportBlob(forcePng);
    return vidRef.current!.exportBlob();
  }, [isImage]);

  async function withBusy(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (error) {
      toast((error as Error)?.message || 'Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  }

  const copy = () =>
    withBusy('copy', async () => {
      const blob = await exportBlob(true);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied at full resolution', 'success');
    });

  const download = () =>
    withBusy('download', async () => {
      const blob = await exportBlob();
      const url = URL.createObjectURL(blob);
      try {
        await browser.downloads.download({ url, filename: `Keepsake/${base || 'keepsake-capture'}${ext}` });
        toast('Saved at full resolution to Downloads/Keepsake', 'success');
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    });

  const saveToLibrary = () =>
    withBusy('save', async () => {
      if (!item) return;
      const blob = await exportBlob();
      let saveId = item.saveId;
      if (saveId) {
        await putBlob(saveId, item.kind, blob);
      } else {
        const result = await saveCaptureToLibrary({
          kind: item.kind,
          blob,
          pageUrl: item.pageUrl,
          pageTitle: item.pageTitle,
          filename: `${base}${ext}`,
          durationMs: item.durationMs,
        });
        saveId = result.saveId;
        if (item.kind === 'recording' && !result.cloudSaved) {
          toast('Saved on this device — upgrade to Pro to sync recordings to your library', 'info');
        }
      }
      await updateStudioItem(item.id, { saveId, blob, filename: `Keepsake/${base}${ext}` });
      setItem({ ...item, saveId });
      setSaved(true);
      toast('Saved to your library', 'success');
    });

  if (item === undefined) return <Shell><p className="p-10 text-center text-sm text-ink-faint">Loading capture…</p></Shell>;
  if (item === null)
    return (
      <Shell>
        <div className="mx-auto mt-24 max-w-md rounded-2xl border border-line bg-surface-raised p-8 text-center shadow-card">
          <h2 className="text-base font-semibold text-ink">Nothing to edit</h2>
          <p className="mt-2 text-sm text-ink-soft">
            This capture is gone — studio copies are kept for 7 days. Take a new screenshot or recording and it will
            open here automatically.
          </p>
        </div>
      </Shell>
    );

  return (
    <Shell>
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-raised px-4 py-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
          <Icon name={isImage ? 'camera' : 'record'} size={16} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <input
              className="w-[26rem] max-w-[40vw] rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-semibold text-ink outline-none hover:border-line focus:border-brand"
              value={base}
              onChange={(event) => {
                setBase(event.target.value);
                setSaved(false);
              }}
              title="File name"
            />
            <span className="text-xs text-ink-faint">{ext}</span>
          </div>
          <p className="truncate px-1.5 text-[11px] text-ink-faint">
            {isImage ? 'Ultra HD screenshot' : 'Screen recording'}
            {mediaInfo ? ` · ${mediaInfo}` : ''}
            {item.pageTitle ? ` · ${item.pageTitle}` : ''}
            {item.pageUrl && /^https?:/i.test(item.pageUrl) && (
              <>
                {' · '}
                <a className="text-brand hover:underline" href={item.pageUrl} target="_blank" rel="noreferrer">
                  open page
                </a>
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {isImage && (
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={copy} disabled={!!busy}>
              <Icon name="copy" size={15} /> {busy === 'copy' ? 'Copying…' : 'Copy'}
            </button>
          )}
          <button className="btn-ghost px-3 py-1.5 text-sm" onClick={download} disabled={!!busy}>
            <Icon name="import" size={15} className="rotate-180" /> {busy === 'download' ? 'Saving…' : 'Download'}
          </button>
          <button className="btn-primary px-3 py-1.5 text-sm" onClick={saveToLibrary} disabled={!!busy || saved}>
            <Icon name={saved ? 'check' : 'bookmark'} size={15} /> {saved ? 'In library' : busy === 'save' ? 'Saving…' : 'Save to library'}
          </button>
        </div>
      </header>

      {isImage ? (
        <ImageEditor ref={imgRef} blob={item.blob} onEdited={() => setSaved(false)} />
      ) : (
        <VideoStudio ref={vidRef} blob={item.blob} durationMs={item.durationMs} onEdited={() => setSaved(false)} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen flex-col overflow-hidden bg-surface-sunken text-ink">{children}</div>;
}
