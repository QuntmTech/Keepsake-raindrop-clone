import { type ReactNode } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { ToastProvider } from './Toast';

// Wraps every surface: applies theme + accent and provides toasts.
function ThemeGate({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  useTheme(settings.theme, settings.accent);
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeGate>
      <ToastProvider>{children}</ToastProvider>
    </ThemeGate>
  );
}
