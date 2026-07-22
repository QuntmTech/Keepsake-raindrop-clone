import { type QuickBarSide } from './types';

// A collection selected in the UI should beat the global default. Passing null
// means the user is explicitly browsing Unsorted and should save with no folder.
export function resolveSaveCollection(
  contextualCollection: string | null | undefined,
  defaultCollection: string | undefined,
  availableCollectionIds: Iterable<string>,
): string {
  const available = new Set(availableCollectionIds);
  if (contextualCollection === null) return '';
  if (contextualCollection && available.has(contextualCollection)) return contextualCollection;
  if (defaultCollection && available.has(defaultCollection)) return defaultCollection;
  return '';
}

export function quickBarSideForPointer(clientX: number, viewportWidth: number): QuickBarSide {
  return clientX < Math.max(1, viewportWidth) / 2 ? 'left' : 'right';
}

export function clampQuickBarTop(
  centerFraction: number,
  viewportHeight: number,
  railHeight: number,
  margin = 8,
): number {
  const safeViewport = Math.max(1, viewportHeight);
  const safeHeight = Math.max(1, railHeight);
  const max = Math.max(margin, safeViewport - safeHeight - margin);
  const wanted = centerFraction * safeViewport - safeHeight / 2;
  return Math.max(margin, Math.min(max, wanted));
}

export function quickBarFractionFromTop(top: number, viewportHeight: number, railHeight: number): number {
  const safeViewport = Math.max(1, viewportHeight);
  return Math.max(0, Math.min(1, (top + Math.max(1, railHeight) / 2) / safeViewport));
}
