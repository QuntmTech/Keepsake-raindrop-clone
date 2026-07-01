import { useRef } from 'react';
import { Icon } from './Icon';
import { Favicon } from './Favicon';

// Pick a bookmark icon three ways: keep the auto-detected favicon, paste an
// image URL, or UPLOAD a file — uploads are cropped square, resized to 64px,
// and stored inline as a data URL so they sync with the bookmark everywhere.
export function IconPicker({
  value,
  fallback,
  onChange,
}: {
  value: string;
  fallback?: string;
  onChange: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await resizeToDataUrl(file, 64);
    if (dataUrl) onChange(dataUrl);
    if (fileRef.current) fileRef.current.value = '';
  }

  const isUpload = value.startsWith('data:');

  return (
    <div className="flex items-center gap-2">
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface-sunken">
        <Favicon src={value || fallback} size={22} />
      </span>
      <input
        className="input py-1.5 text-xs"
        value={isUpload ? '' : value}
        placeholder={isUpload ? 'Custom uploaded icon ✓' : 'Icon URL (blank = auto-detect)'}
        onChange={(e) => onChange(e.target.value)}
      />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      <button
        type="button"
        className="btn-outline shrink-0 px-2.5 py-1.5 text-xs"
        onClick={() => fileRef.current?.click()}
        title="Upload an image from your computer"
      >
        <Icon name="import" size={14} /> Upload
      </button>
      {value && (
        <button
          type="button"
          className="btn-ghost shrink-0 px-2 py-1.5"
          onClick={() => onChange('')}
          title="Reset to auto-detected icon"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

// Crop-to-square + resize an image file, returning a compact PNG data URL.
function resizeToDataUrl(file: File, size: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
