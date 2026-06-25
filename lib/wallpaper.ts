// Home wallpaper presets + custom image support. Stored in Settings.wallpaper as
// either a preset key, '' (none), or 'url:<image url>'.

export interface Wallpaper {
  key: string;
  label: string;
  css: string; // CSS background value
}

export const WALLPAPERS: Wallpaper[] = [
  { key: '', label: 'None', css: '' },
  { key: 'aurora', label: 'Aurora', css: 'linear-gradient(135deg,#1e3a8a 0%,#6d28d9 50%,#db2777 100%)' },
  { key: 'dusk', label: 'Dusk', css: 'linear-gradient(135deg,#0f172a 0%,#334155 55%,#0ea5e9 100%)' },
  { key: 'forest', label: 'Forest', css: 'linear-gradient(135deg,#064e3b 0%,#10b981 100%)' },
  { key: 'sunrise', label: 'Sunrise', css: 'linear-gradient(135deg,#7c2d12 0%,#ea580c 50%,#f59e0b 100%)' },
  { key: 'grape', label: 'Grape', css: 'linear-gradient(135deg,#3b0764 0%,#7c3aed 100%)' },
  { key: 'charcoal', label: 'Charcoal', css: 'linear-gradient(135deg,#0b0f17 0%,#374151 100%)' },
];

export function wallpaperCss(value: string): string {
  if (!value) return '';
  if (value.startsWith('url:')) return `center / cover no-repeat url("${value.slice(4)}")`;
  return WALLPAPERS.find((w) => w.key === value)?.css ?? '';
}

export function hasWallpaper(value: string): boolean {
  return Boolean(wallpaperCss(value));
}
