import { pb, currentUserId } from './pocketbase';
import { type Highlight, type HighlightColor } from './types';

export interface CreateHighlightInput {
  url: string;
  text: string;
  color?: HighlightColor;
  note?: string;
  bookmark?: string;
  anchor?: string; // serialized range; Claude Code: see content.ts for the anchoring TODO
}

export async function createHighlight(input: CreateHighlightInput): Promise<Highlight> {
  const user = currentUserId();
  if (!user) throw new Error('Not logged in');
  const rec = await pb.collection('highlights').create({
    url: input.url,
    text: input.text,
    color: input.color ?? 'yellow',
    note: input.note ?? '',
    bookmark: input.bookmark,
    anchor: input.anchor ?? '',
    user,
  });
  return rec as unknown as Highlight;
}

export async function highlightsForUrl(url: string): Promise<Highlight[]> {
  const user = currentUserId();
  if (!user) throw new Error('Not logged in');
  const u = url.replace(/"/g, '\\"');
  const list = await pb.collection('highlights').getFullList({
    filter: `user = "${user}" && url = "${u}"`,
    sort: 'created',
  });
  return list as unknown as Highlight[];
}

export async function deleteHighlight(id: string): Promise<void> {
  await pb.collection('highlights').delete(id);
}

export async function updateHighlightNote(id: string, note: string): Promise<void> {
  await pb.collection('highlights').update(id, { note });
}
