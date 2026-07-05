import { type ReactNode } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useTheme } from '@/hooks/useTheme';
import { ToastProvider } from './Toast';
import { ErrorBoundary } from './ErrorBoundary';

// Wraps every surface: applies theme + accent and provides toasts.
function ThemeGate({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  useTheme(settings.theme, settings.accent);
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  // The boundary sits OUTSIDE the theme gate so even a theme/settings crash
  // still renders the recovery card instead of a blank page.
  return (
    <ErrorBoundary>
      <ThemeGate>
        <ToastProvider>{children}</ToastProvider>
      </ThemeGate>
    </ErrorBoundary>
  );
}
