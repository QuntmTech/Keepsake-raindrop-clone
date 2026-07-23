import { type WriterAction } from './aiWriterPrompt';
import {
  type AiSelectionActionRef,
  type AiSelectionBuiltinAction,
  type AiSelectionCustomAction,
} from './types';

export interface AiSelectionActionDefinition {
  id: AiSelectionBuiltinAction;
  label: string;
  shortLabel: string;
  description: string;
  writerAction: WriterAction;
  creditCost: 1 | 2;
}

export const AI_SELECTION_BUILTINS: AiSelectionActionDefinition[] = [
  { id: 'improve', label: 'Improve writing', shortLabel: 'Improve', description: 'Clean up clarity and flow.', writerAction: 'improve', creditCost: 1 },
  { id: 'summarize', label: 'Summarize', shortLabel: 'Summarize', description: 'Create a concise summary.', writerAction: 'summarize', creditCost: 2 },
  { id: 'explain', label: 'Explain simply', shortLabel: 'Explain', description: 'Explain the selection in plain language.', writerAction: 'explain', creditCost: 2 },
  { id: 'keypoints', label: 'Extract key points', shortLabel: 'Key points', description: 'Turn the selection into useful bullets.', writerAction: 'keypoints', creditCost: 2 },
  { id: 'reply', label: 'Draft a reply', shortLabel: 'Reply', description: 'Create a ready-to-send response.', writerAction: 'reply', creditCost: 2 },
  { id: 'translate', label: 'Translate', shortLabel: 'Translate', description: 'Translate into your chosen language.', writerAction: 'translate', creditCost: 1 },
  { id: 'grammar', label: 'Fix grammar', shortLabel: 'Grammar', description: 'Correct spelling, grammar, and punctuation.', writerAction: 'grammar', creditCost: 1 },
  { id: 'shorten', label: 'Shorten', shortLabel: 'Shorten', description: 'Make it tighter without losing meaning.', writerAction: 'shorten', creditCost: 1 },
  { id: 'professional', label: 'Make professional', shortLabel: 'Professional', description: 'Use a polished professional tone.', writerAction: 'professional', creditCost: 2 },
];

export const DEFAULT_AI_SELECTION_ACTIONS: AiSelectionActionRef[] = [
  'improve',
  'summarize',
  'explain',
  'reply',
  'translate',
  'shorten',
];

const BUILTIN_BY_ID = new Map(AI_SELECTION_BUILTINS.map((action) => [action.id, action]));

export function isBuiltinSelectionAction(value: string): value is AiSelectionBuiltinAction {
  return BUILTIN_BY_ID.has(value as AiSelectionBuiltinAction);
}

export interface ResolvedSelectionAction {
  ref: AiSelectionActionRef;
  label: string;
  shortLabel: string;
  description: string;
  writerAction: WriterAction;
  customInstruction?: string;
  creditCost: 1 | 2;
}

export function resolveSelectionAction(
  ref: AiSelectionActionRef,
  customActions: AiSelectionCustomAction[],
): ResolvedSelectionAction | null {
  if (isBuiltinSelectionAction(ref)) {
    const builtIn = BUILTIN_BY_ID.get(ref)!;
    return { ref, ...builtIn };
  }
  if (!ref.startsWith('custom:')) return null;
  const id = ref.slice('custom:'.length);
  const custom = customActions.find((action) => action.id === id);
  if (!custom?.label.trim() || !custom.instruction.trim()) return null;
  return {
    ref,
    label: custom.label.trim().slice(0, 40),
    shortLabel: custom.label.trim().slice(0, 18),
    description: custom.instruction.trim().slice(0, 160),
    writerAction: 'custom',
    customInstruction: custom.instruction.trim().slice(0, 1200),
    creditCost: 2,
  };
}

export function orderedSelectionActions(
  refs: AiSelectionActionRef[],
  customActions: AiSelectionCustomAction[],
): ResolvedSelectionAction[] {
  const seen = new Set<string>();
  const output: ResolvedSelectionAction[] = [];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const resolved = resolveSelectionAction(ref, customActions);
    if (resolved) output.push(resolved);
  }
  return output;
}
