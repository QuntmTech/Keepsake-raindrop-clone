import { useEffect, useState } from 'react';
import { Icon } from './Icon';

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
  // A tile can be recycled for a different bookmark (list reorder) — give the
  // new src a fresh chance instead of staying stuck on the fallback.
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
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
      src={src}
      alt=""
      width={size}
      height={size}
      className={`rounded-sm ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
