import { storage } from 'wxt/utils/storage';

export type SidepanelTarget = 'ai';

const targetStore = storage.defineItem<SidepanelTarget | null>('session:sidepanel_target', {
  fallback: null,
});

export async function requestSidepanelTarget(target: SidepanelTarget): Promise<void> {
  await targetStore.setValue(target);
}

export async function consumeSidepanelTarget(): Promise<SidepanelTarget | null> {
  const target = await targetStore.getValue();
  if (target) await targetStore.setValue(null);
  return target;
}

export function watchSidepanelTarget(callback: (target: SidepanelTarget) => void): () => void {
  return targetStore.watch((value) => {
    if (!value) return;
    callback(value);
    targetStore.setValue(null).catch(() => {});
  });
}
