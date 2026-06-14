import { useState } from 'react';
import { Icon } from './Icon';

// A favicon that gracefully falls back to a glyph if the image fails to load,
// so broken favicons never show the browser's ugly broken-image icon.
export function Favicon({ src, size = 16, className = '' }: { src?: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
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
