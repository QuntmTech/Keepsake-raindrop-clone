import { storage } from 'wxt/utils/storage';
import { llmComplete } from './llm';
import {
  buildWriterPrompt,
  type WriterAction,
  type WriterLength,
  type WriterRequest,
  type WriterTone,
} from './aiWriterPrompt';

export interface WriterDraft {
  input: string;
  output: string;
  action: WriterAction;
  tone: WriterTone;
  length: WriterLength;
  customInstruction: string;
}

export const DEFAULT_WRITER_DRAFT: WriterDraft = {
  input: '',
  output: '',
  action: 'improve',
  tone: 'preserve',
  length: 'same',
  customInstruction: '',
};

const draftStore = storage.defineItem<WriterDraft>('session:ai_writer_draft', {
  fallback: DEFAULT_WRITER_DRAFT,
});

export async function getWriterDraft(): Promise<WriterDraft> {
  return { ...DEFAULT_WRITER_DRAFT, ...(await draftStore.getValue()) };
}

export async function setWriterDraft(patch: Partial<WriterDraft>): Promise<WriterDraft> {
  const next = { ...(await getWriterDraft()), ...patch };
  await draftStore.setValue(next);
  return next;
}

export async function runWriter(request: WriterRequest): Promise<string> {
  const built = buildWriterPrompt(request);
  return llmComplete({
    tier: 'fast',
    system: built.system,
    prompt: built.prompt,
    maxTokens: built.maxTokens,
  });
}
