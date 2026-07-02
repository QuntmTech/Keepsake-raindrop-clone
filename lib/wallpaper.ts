import { storage } from 'wxt/utils/storage';

// Home wallpaper presets + custom backgrounds. Stored in Settings.wallpaper as:
//   ''            → none
//   <preset key>  → a built-in gradient
//   'url:<url>'    → a remote image URL
//   'color:<hex>' → a solid color
//   'upload'      → an image the user uploaded (data URL lives in the local
//                   store below — too large for synced settings).

export interface Wallpaper {
  key: string;
  label: string;
  css: string; // CSS background value
}

// The uploaded background image (data URL). Kept in local (unlimitedStorage),
// not in synced settings which have a tiny per-item size cap.
export const wallpaperUpload = storage.defineItem<string>('local:home_wallpaper_upload', { fallback: '' });

// A few quick solid-color presets for the picker.
export const COLOR_SWATCHES = ['#0b0f17', '#1e293b', '#111827', '#f8fafc', '#e2e8f0', '#fee2e2', '#dcfce7', '#dbeafe'];

export const WALLPAPERS: Wallpaper[] = [
  { key: '', label: 'None', css: '' },
  { key: 'aurora', label: 'Aurora', css: 'linear-gradient(135deg,#1e3a8a 0%,#6d28d9 50%,#db2777 100%)' },
  { key: 'dusk', label: 'Dusk', css: 'linear-gradient(135deg,#0f172a 0%,#334155 55%,#0ea5e9 100%)' },
  { key: 'forest', label: 'Forest', css: 'linear-gradient(135deg,#064e3b 0%,#10b981 100%)' },
  { key: 'sunrise', label: 'Sunrise', css: 'linear-gradient(135deg,#7c2d12 0%,#ea580c 50%,#f59e0b 100%)' },
  { key: 'grape', label: 'Grape', css: 'linear-gradient(135deg,#3b0764 0%,#7c3aed 100%)' },
  { key: 'charcoal', label: 'Charcoal', css: 'linear-gradient(135deg,#0b0f17 0%,#374151 100%)' },
];

export function wallpaperCss(value: string, uploaded?: string): string {
  if (!value) return '';
  if (value === 'upload') return uploaded ? `center / cover no-repeat fixed url("${uploaded}")` : '';
  if (value.startsWith('url:')) return `center / cover no-repeat fixed url("${value.slice(4)}")`;
  if (value.startsWith('color:')) return value.slice(6);
  return WALLPAPERS.find((w) => w.key === value)?.css ?? '';
}

export function hasWallpaper(value: string, uploaded?: string): boolean {
  return Boolean(wallpaperCss(value, uploaded));
}

// Relative luminance (0=black, 1=white) of a #rrggbb color — used to pick
// readable text over a solid-color background.
export function colorLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Downscale + encode an uploaded image so it stays reasonable in storage and
// renders fast, without needing any network.
export function imageFileToDataUrl(file: File, maxDim = 2560): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(reader.result as string);
        ctx.drawImage(img, 0, 0, w, h);
        // JPEG keeps big photos small; PNG uploads with transparency are rare
        // for a full-page background.
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
