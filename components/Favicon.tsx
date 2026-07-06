import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { cachedIcon, ensureIcon } from '@/lib/favicons';

// Deterministic hue per label so a site's letter tile keeps its color.
const TILE_COLORS = ['#4f7cf7', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#14b8a6'];
function tileColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

// A favicon that gracefully falls back if the image fails to load: to a
// colored letter tile when we know the site's name, else to a glyph — so
// broken favicons never show the browser's ugly broken-image icon.
export function Favicon({
  src,
  size = 16,
  className = '',
  label,
}: {
  src?: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  // Prefer a cached data URI (instant, offline, no per-open network). Seed from
  // the in-memory cache so an already-warmed icon renders with no flash; then
  // resolve through IndexedDB / a one-time network fetch and swap in the result.
  const [resolved, setResolved] = useState<string | undefined>(() => cachedIcon(src) ?? src);
  // A tile can be recycled for a different bookmark (list reorder) — give the
  // new src a fresh chance instead of staying stuck on the fallback.
  useEffect(() => {
    setFailed(false);
    const hit = cachedIcon(src);
    if (hit) {
      setResolved(hit);
      return;
    }
    setResolved(src); // paint the network URL / fallback while we resolve
    if (!src) return;
    let alive = true;
    ensureIcon(src).then((data) => {
      // A cached/fetched data URI wins — and clears any failure the optimistic
      // network <img> already hit (e.g. offline, where only the cache resolves).
      if (alive && data) {
        setResolved(data);
        setFailed(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [src]);
  if (!resolved || failed) {
    const letter = label?.trim().charAt(0).toUpperCase();
    if (letter) {
      return (
        <span
          className={`grid shrink-0 place-items-center rounded-md font-semibold text-white ${className}`}
          style={{ width: size, height: size, background: tileColor(label!.trim()), fontSize: Math.max(10, size * 0.5) }}
        >
          {letter}
        </span>
      );
    }
    return <Icon name="bookmark" size={size - 2} className={`text-ink-faint ${className}`} />;
  }
  return (
    <img
      src={resolved}
      alt=""
      width={size}
      height={size}
      // Native <img> drag would hijack the tile's own drag-and-drop (you'd grab
      // the favicon, not the tile/folder). Keep the drag on the tile container.
      draggable={false}
      className={`rounded-sm ${className}`}
      style={{ width: size, height: size, WebkitUserDrag: 'none' } as React.CSSProperties}
      onError={() => setFailed(true)}
    />
  );
}
