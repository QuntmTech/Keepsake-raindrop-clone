import { storage } from 'wxt/utils/storage';

export interface SavedPrompt {
  id: string;
  name: string;
  instruction: string;
  shortcut: string;
  createdAt: number;
  updatedAt: number;
  builtIn?: boolean;
}

const BUILT_INS: SavedPrompt[] = [
  {
    id: 'builtin-founder-update',
    name: 'Founder update',
    shortcut: 'founder',
    instruction: 'Rewrite this as a concise founder update: clear progress, concrete results, current blocker, and next action. Sound confident but not overhyped.',
    createdAt: 0,
    updatedAt: 0,
    builtIn: true,
  },
  {
    id: 'builtin-human-reply',
    name: 'Natural reply',
    shortcut: 'reply',
    instruction: 'Write a short, natural reply that directly addresses the message. Sound like a real person, not a template. Do not over-explain.',
    createdAt: 0,
    updatedAt: 0,
    builtIn: true,
  },
  {
    id: 'builtin-sales-copy',
    name: 'Sharper sales copy',
    shortcut: 'sales',
    instruction: 'Rewrite this to make the value immediately obvious, remove filler, strengthen the benefit, add specificity, and end with a clear next step. Do not invent claims.',
    createdAt: 0,
    updatedAt: 0,
    builtIn: true,
  },
  {
    id: 'builtin-plain-language',
    name: 'Plain language',
    shortcut: 'simple',
    instruction: 'Rewrite this so a smart fifth grader can understand it. Use plain words and short sentences without removing important details.',
    createdAt: 0,
    updatedAt: 0,
    builtIn: true,
  },
];

const store = storage.defineItem<SavedPrompt[]>('local:ai_prompt_library', { fallback: [] });

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function cleanInstruction(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, 1200);
}

function cleanShortcut(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
}

function normalized(items: SavedPrompt[]): SavedPrompt[] {
  const seen = new Set<string>();
  const output: SavedPrompt[] = [];
  for (const item of items) {
    const name = cleanName(item.name);
    const instruction = cleanInstruction(item.instruction);
    if (!item.id || !name || !instruction || seen.has(item.id)) continue;
    seen.add(item.id);
    output.push({
      ...item,
      name,
      instruction,
      shortcut: cleanShortcut(item.shortcut || name),
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
      builtIn: Boolean(item.builtIn),
    });
  }
  return output;
}

export async function listSavedPrompts(): Promise<SavedPrompt[]> {
  const custom = normalized(await store.getValue()).sort((a, b) => b.updatedAt - a.updatedAt);
  return [...BUILT_INS, ...custom];
}

export async function savePrompt(input: {
  id?: string;
  name: string;
  instruction: string;
  shortcut?: string;
}): Promise<SavedPrompt> {
  const name = cleanName(input.name);
  const instruction = cleanInstruction(input.instruction);
  if (!name) throw new Error('Give the prompt a name.');
  if (!instruction) throw new Error('Add a prompt instruction.');

  const now = Date.now();
  const current = normalized(await store.getValue());
  const existing = input.id ? current.find((item) => item.id === input.id) : undefined;
  const prompt: SavedPrompt = {
    id: existing?.id || crypto.randomUUID(),
    name,
    instruction,
    shortcut: cleanShortcut(input.shortcut || name),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  const next = [prompt, ...current.filter((item) => item.id !== prompt.id)].slice(0, 100);
  await store.setValue(next);
  return prompt;
}

export async function deletePrompt(id: string): Promise<void> {
  if (id.startsWith('builtin-')) return;
  await store.setValue((await store.getValue()).filter((item) => item.id !== id));
}

export async function promptById(id: string): Promise<SavedPrompt | undefined> {
  return (await listSavedPrompts()).find((prompt) => prompt.id === id);
}

export async function findPromptBySlash(value: string): Promise<SavedPrompt | undefined> {
  const match = value.trim().match(/^\/([a-z0-9_-]+)/i);
  if (!match) return undefined;
  const shortcut = cleanShortcut(match[1]);
  return (await listSavedPrompts()).find((prompt) => prompt.shortcut === shortcut);
}
