import { storage } from 'wxt/utils/storage';
import { llmCompleteDetailed, type LlmResult } from './llm';
import {
  buildWriterPrompt,
  type WriterAction,
  type WriterLength,
  type WriterRequest,
  type WriterTone,
} from './aiWriterPrompt';
import { type AiRouteMode } from './types';

export interface WriterDraft {
  input: string;
  output: string;
  action: WriterAction;
  tone: WriterTone;
  length: WriterLength;
  quality: AiRouteMode;
  customInstruction: string;
  targetLanguage: string;
  selectedPromptId: string;
}

export const DEFAULT_WRITER_DRAFT: WriterDraft = {
  input: '',
  output: '',
  action: 'improve',
  tone: 'preserve',
  length: 'same',
  quality: 'auto',
  customInstruction: '',
  targetLanguage: 'English',
  selectedPromptId: '',
};

const draftStore = storage.defineItem<WriterDraft>('session:ai_writer_draft', {
  fallback: DEFAULT_WRITER_DRAFT,
});

function normalizeDraft(value?: Partial<WriterDraft> | null): WriterDraft {
  return { ...DEFAULT_WRITER_DRAFT, ...(value ?? {}) };
}

export async function getWriterDraft(): Promise<WriterDraft> {
  return normalizeDraft(await draftStore.getValue());
}

export async function setWriterDraft(patch: Partial<WriterDraft>): Promise<WriterDraft> {
  const next = normalizeDraft({ ...(await getWriterDraft()), ...patch });
  await draftStore.setValue(next);
  return next;
}

export function watchWriterDraft(callback: (draft: WriterDraft) => void): () => void {
  return draftStore.watch((value) => callback(normalizeDraft(value)));
}

export async function clearWriterDraft(): Promise<WriterDraft> {
  await draftStore.setValue(DEFAULT_WRITER_DRAFT);
  return DEFAULT_WRITER_DRAFT;
}

export async function runWriterDetailed(
  request: WriterRequest & { quality?: AiRouteMode; signal?: AbortSignal; overallTimeoutMs?: number },
): Promise<LlmResult> {
  const built = buildWriterPrompt(request);
  const contextHeavy = request.action === 'custom' || request.action === 'reply' || request.action === 'translate';
  return llmCompleteDetailed({
    tier: contextHeavy ? 'smart' : 'fast',
    task: request.action === 'custom' ? 'custom-writer' : 'writer',
    routeMode: request.quality,
    system: built.system,
    prompt: built.prompt,
    maxTokens: built.maxTokens,
    temperature: request.action === 'grammar' || request.action === 'translate' ? 0.15 : 0.45,
    signal: request.signal,
    overallTimeoutMs: request.overallTimeoutMs,
  });
}

export async function runWriter(
  request: WriterRequest & { quality?: AiRouteMode; signal?: AbortSignal; overallTimeoutMs?: number },
): Promise<string> {
  return (await runWriterDetailed(request)).text;
}
