import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useToast } from '@/components/Toast';
import { getStudioItem, putBlob, updateStudioItem, type StudioItem } from '@/lib/save';
import { saveCaptureToLibrary } from '@/lib/captureSave';
import { ImageEditor, type ImageEditorHandle, type ImageExportFormat } from './ImageEditor';
import { VideoStudio, type VideoStudioHandle } from './VideoStudio';

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'video/webm': '.webm',
};

const FORMAT_LABEL: Record<ImageExportFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  pdf: 'PDF',
};

function extensionForBlob(blob: Blob, fallback: string): string {
  return EXTENSION_BY_TYPE[blob.type] || fallback;
}

// Capture Studio — every screenshot and recording opens here right after
// capture. Screenshots use a lightweight preview while export composes once at
// full resolution, so enormous scrolling captures stay responsive.
export default function App() {
  const { toast } = useToast();
  const [item, setItem] = useState<StudioItem | null | undefined>(undefined);
  const [base, setBase] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [mediaInfo, setMediaInfo] = useState('');
  const [format, setFormat] = useState<ImageExportFormat>('png');
  const imgRef = useRef<ImageEditorHandle>(null);
  const vidRef = useRef<VideoStudioHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = location.hash.slice(1);
    if (!id) return setItem(null);
    getStudioItem(id).then(async (next) => {
      setItem(next ?? null);
      if (!next) return;
      const name = next.filename.split('/').pop() ?? next.filename;
      setBase(name.replace(/\.[a-z0-9]+$/i, ''));
      setSaved(Boolean(next.saveId));
      updateMediaInfo(next);
    });
  }, []);

  const updateMediaInfo = (next: StudioItem) => {
    const megabytes = next.blob.size / (1024 * 1024);
    if (next.kind === 'screenshot') {
      if (next.width && next.height) {
        const megapixels = (next.width * next.height) / 1_000_000;
        setMediaInfo(`${next.width.toLocaleString()} × ${next.height.toLocaleString()} px · ${megapixels.toFixed(1)} MP · ${megabytes.toFixed(1)} MB`);
      } else {
        setMediaInfo(`${megabytes.toFixed(1)} MB · ${next.blob.type || 'image'}`);
      }
      return;
    }
    const seconds = Math.max(0, Math.round((next.durationMs ?? 0) / 1000));
    const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    setMediaInfo(`${duration} · ${megabytes.toFixed(1)} MB · ${next.blob.type || 'video/webm'}`);
  };

  const originalExt = item
    ? (item.filename.match(/\.[a-z0-9]+$/i)?.[0] ?? (item.kind === 'recording' ? '.webm' : '.png'))
    : '';
  const isImage = item?.kind === 'screenshot';

  const exportBlob = useCallback(
    async (options?: { format?: ImageExportFormat; maxPixels?: number }): Promise<Blob> => {
      if (isImage) {
        return imgRef.current!.exportBlob({
          format: options?.format ?? format,
          quality: 0.94,
          maxPixels: options?.maxPixels,
        });
      }
      return vidRef.current!.exportBlob();
    },
    [format, isImage],
  );

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
      // Clipboard PNGs become enormous in memory. Keep the visual fidelity but
      // cap the clipboard copy to 16 MP; Download still preserves full resolution.
      const pixels = (item?.width ?? 0) * (item?.height ?? 0);
      const maxPixels = pixels > 16_000_000 ? 16_000_000 : undefined;
      const blob = await exportBlob({ format: 'png', maxPixels });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(maxPixels ? 'Copied an optimized high-resolution version — Download keeps every pixel' : 'Copied at full resolution', 'success');
    });

  const download = () =>
    withBusy('download', async () => {
      const blob = await exportBlob();
      const outputExt = extensionForBlob(blob, originalExt);
      const url = URL.createObjectURL(blob);
      try {
        await browser.downloads.download({
          url,
          filename: `Keepsake/${base || 'keepsake-capture'}${outputExt}`,
          saveAs: false,
        });
        toast(`Saved ${isImage ? FORMAT_LABEL[format] : 'recording'} to Downloads/Keepsake`, 'success');
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    });

  const saveToLibrary = () =>
    withBusy('save', async () => {
      if (!item) return;
      // Library previews should stay browser-friendly; PDF remains a Download format.
      const libraryFormat: ImageExportFormat = format === 'pdf' ? 'png' : format;
      const blob = await exportBlob({ format: libraryFormat });
      const outputExt = extensionForBlob(blob, originalExt);
      let saveId = item.saveId;
      if (saveId) {
        await putBlob(saveId, item.kind, blob);
      } else {
        const result = await saveCaptureToLibrary({
          kind: item.kind,
          blob,
          pageUrl: item.pageUrl,
          pageTitle: item.pageTitle,
          filename: `${base}${outputExt}`,
          durationMs: item.durationMs,
        });
        saveId = result.saveId;
        if (item.kind === 'recording' && !result.cloudSaved) {
          toast('Saved on this device — upgrade to Pro to sync recordings to your library', 'info');
        }
      }
      await updateStudioItem(item.id, { saveId, blob, filename: `Keepsake/${base}${outputExt}` });
      setItem({ ...item, saveId, blob, filename: `Keepsake/${base}${outputExt}` });
      setSaved(true);
      toast('Saved to your library', 'success');
    });

  async function replaceImage(file: File | undefined) {
    if (!file || !item || item.kind !== 'screenshot') return;
    if (!file.type.startsWith('image/')) {
      toast('Choose a PNG, JPEG, WebP, GIF, or other browser-readable image', 'error');
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const width = bitmap.width;
      const height = bitmap.height;
      bitmap.close();
      const name = file.name.replace(/\.[a-z0-9]+$/i, '') || 'imported-image';
      const next: StudioItem = {
        ...item,
        blob: file,
        width,
        height,
        filename: `Keepsake/${name}${file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '.png'}`,
        saveId: undefined,
      };
      await updateStudioItem(item.id, {
        blob: file,
        width,
        height,
        filename: next.filename,
        saveId: undefined,
      });
      setItem(next);
      setBase(name);
      setSaved(false);
      updateMediaInfo(next);
      toast('Image opened in Capture Studio', 'success');
    } catch {
      toast('That image could not be decoded', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (item === undefined) return <Shell><p className="p-10 text-center text-sm text-ink-faint">Loading capture…</p></Shell>;
  if (item === null) {
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
  }

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
            <span className="text-xs text-ink-faint">
              {isImage ? (format === 'jpeg' ? '.jpg' : `.${format}`) : originalExt}
            </span>
          </div>
          <p className="truncate px-1.5 text-[11px] text-ink-faint">
            {isImage ? 'Capture Studio image' : 'Screen recording'}
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
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {isImage && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => replaceImage(event.target.files?.[0])}
              />
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                <Icon name="image" size={15} /> Open image
              </button>
              <label className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-soft">
                Format
                <select
                  className="bg-transparent text-xs text-ink outline-none"
                  value={format}
                  onChange={(event) => setFormat(event.target.value as ImageExportFormat)}
                >
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="webp">WebP</option>
                  <option value="pdf">PDF</option>
                </select>
              </label>
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={copy} disabled={!!busy}>
                <Icon name="copy" size={15} /> {busy === 'copy' ? 'Copying…' : 'Copy'}
              </button>
            </>
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
        <ImageEditor key={`${item.id}:${item.blob.size}:${item.blob.type}`} ref={imgRef} blob={item.blob} onEdited={() => setSaved(false)} />
      ) : (
        <VideoStudio ref={vidRef} blob={item.blob} durationMs={item.durationMs} onEdited={() => setSaved(false)} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex h-screen flex-col overflow-hidden bg-surface-sunken text-ink">{children}</div>;
}
