import { type QuickBarAction } from './types';

export const DEFAULT_QUICKBAR_ORDER: QuickBarAction[] = ['popup', 'save', 'folder', 'dashboard', 'custom'];

const ACTIONS = new Set<QuickBarAction>(DEFAULT_QUICKBAR_ORDER);

export function normalizeQuickBarOrder(value: unknown): QuickBarAction[] {
  const input = Array.isArray(value) ? value : [];
  const result: QuickBarAction[] = [];
  for (const item of input) {
    if (typeof item !== 'string' || !ACTIONS.has(item as QuickBarAction)) continue;
    const action = item as QuickBarAction;
    if (!result.includes(action)) result.push(action);
  }
  for (const action of DEFAULT_QUICKBAR_ORDER) {
    if (!result.includes(action)) result.push(action);
  }
  return result;
}

export function reorderQuickBarAction(
  order: QuickBarAction[],
  dragged: QuickBarAction,
  target: QuickBarAction,
): QuickBarAction[] {
  const normalized = normalizeQuickBarOrder(order);
  if (dragged === target) return normalized;
  const without = normalized.filter((item) => item !== dragged);
  const targetIndex = without.indexOf(target);
  if (targetIndex < 0) return normalized;
  without.splice(targetIndex, 0, dragged);
  return without;
}

export function normalizeQuickBarColor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1).split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return '';
}

export function normalizeQuickBarUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}
