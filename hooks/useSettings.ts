import { useEffect, useState } from 'react';
import { getSettings, setSettings as save, watchSettings } from '@/lib/settings';
import { type Settings, DEFAULT_SETTINGS } from '@/lib/types';

export function useSettings() {
  const [settings, setLocal] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    getSettings().then(setLocal);
    return watchSettings(setLocal);
  }, []);

  async function update(patch: Partial<Settings>) {
    const next = await save(patch);
    setLocal(next);
  }

  return { settings, update };
}
