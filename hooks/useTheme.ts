import { useEffect } from 'react';
import { applyTheme, watchSystemTheme } from '@/lib/theme';
import { type Accent, type ThemeMode } from '@/lib/types';

// Applies theme + accent whenever they change, and follows the OS in system mode.
export function useTheme(theme: ThemeMode, accent: Accent) {
  useEffect(() => {
    applyTheme(theme, accent);
    if (theme !== 'system') return;
    return watchSystemTheme(() => applyTheme(theme, accent));
  }, [theme, accent]);
}
