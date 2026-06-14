import { useEffect, useState } from 'react';
import { getSettings, setSettings as save, watchSettings } from '@/lib/settings';
import { type Settings, DEFAULT_SETTINGS } from '@/lib/types';

export function useSettings() {
  const [settings, setLocal] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setLocal(s);
      setReady(true);
    });
    return watchSettings(setLocal);
  }, []);

  async function update(patch: Partial<Settings>) {
    const next = await save(patch);
    setLocal(next);
  }

  return { settings, ready, update };
}
