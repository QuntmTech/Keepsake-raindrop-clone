import { useEffect } from 'react';

// Calls `onClose` when Escape is pressed. Used by modals/overlays so every
// dismissible surface is keyboard-closable.
export function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, active]);
}
