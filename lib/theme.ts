import { type Accent, type ThemeMode } from './types';

// Applies theme + accent to the document root. Called by useTheme on every
// surface so light/dark/accent are consistent everywhere, including system mode.

export function applyTheme(theme: ThemeMode, accent: Accent): void {
  const root = document.documentElement;
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', Boolean(dark));
  root.dataset.accent = accent;
}

// Subscribe to OS theme changes (only matters while theme === 'system').
export function watchSystemTheme(cb: () => void): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return () => {};
  const handler = () => cb();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export const ACCENTS: { key: Accent; label: string; swatch: string }[] = [
  { key: 'ocean', label: 'Ocean', swatch: '#2563eb' },
  { key: 'violet', label: 'Violet', swatch: '#7c3aed' },
  { key: 'emerald', label: 'Emerald', swatch: '#10b981' },
  { key: 'sunset', label: 'Sunset', swatch: '#ea580c' },
  { key: 'rose', label: 'Rose', swatch: '#e11d48' },
  { key: 'slate', label: 'Slate', swatch: '#475569' },
];
