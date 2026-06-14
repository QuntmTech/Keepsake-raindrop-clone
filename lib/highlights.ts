import { getBackend } from './backend';
import { type Highlight, type HighlightColor, type TextQuoteAnchor } from './types';
import { type CreateHighlightInput } from './backend/types';

// Facade over the active backend for highlight CRUD.

export type { CreateHighlightInput };

export async function createHighlight(input: CreateHighlightInput): Promise<Highlight> {
  return (await getBackend()).createHighlight(input);
}

export async function highlightsForUrl(url: string): Promise<Highlight[]> {
  return (await getBackend()).highlightsForUrl(url);
}

export async function allHighlights(limit = 200): Promise<Highlight[]> {
  return (await getBackend()).allHighlights(limit);
}

export async function deleteHighlight(id: string): Promise<void> {
  return (await getBackend()).deleteHighlight(id);
}

export async function updateHighlight(
  id: string,
  patch: { note?: string; color?: HighlightColor },
): Promise<void> {
  return (await getBackend()).updateHighlight(id, patch);
}

export function parseAnchor(raw?: string): TextQuoteAnchor | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TextQuoteAnchor;
  } catch {
    return null;
  }
}
