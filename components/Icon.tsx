// Minimal inline icon set (stroke-based, currentColor). Keeps the bundle tiny
// and avoids pulling in an icon library.

export type IconName =
  | 'bookmark' | 'search' | 'plus' | 'star' | 'star-fill' | 'trash' | 'settings'
  | 'grid' | 'list' | 'masonry' | 'sparkles' | 'folder' | 'tag' | 'external'
  | 'chevron' | 'close' | 'check' | 'highlight' | 'sun' | 'moon' | 'command'
  | 'video' | 'image' | 'pdf' | 'repo' | 'doc' | 'link' | 'logout' | 'import'
  | 'edit' | 'inbox';

const paths: Record<IconName, string> = {
  bookmark: 'M6 4h12v16l-6-4-6 4z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  star: 'M12 3l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 18.8 6.2 21l1.1-6.5L2.5 9.9 9 9z',
  'star-fill': 'M12 3l2.9 6 6.6.9-4.8 4.6 1.1 6.5L12 18.8 6.2 21l1.1-6.5L2.5 9.9 9 9z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  settings: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  masonry: 'M4 4h7v10H4zM13 4h7v6h-7M4 16h7v4H4M13 12h7v8h-7z',
  sparkles: 'M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  tag: 'M3 12l9-9 9 9-9 9zM8 8h.01',
  external: 'M14 5h5v5M19 5l-9 9M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6',
  chevron: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 13l4 4L19 7',
  highlight: 'M4 20h16M6 16l8-8 4 4-8 8H6z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  moon: 'M21 12.8A8.5 8.5 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8z',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z',
  video: 'M3 6h13v12H3zM16 9l5-3v12l-5-3z',
  image: 'M3 5h18v14H3zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM21 16l-5-5L5 21',
  pdf: 'M7 3h7l5 5v13H7zM14 3v5h5',
  repo: 'M6 3h11a2 2 0 0 1 2 2v16l-7-3-7 3V5a2 2 0 0 1 1-2z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  logout: 'M16 17l5-5-5-5M21 12H9M9 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4',
  import: 'M12 3v12M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  inbox: 'M4 13l2-9h12l2 9M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6M4 13h5l1 2h4l1-2h5',
};

export function Icon({
  name,
  size = 18,
  className = '',
  fill = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  fill?: boolean;
}) {
  const solid = fill || name === 'star-fill';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
