import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  msg: string;
  kind: ToastKind;
}

interface ToastApi {
  toast: (msg: string, kind?: ToastKind) => void;
}

const ToastCtx = createContext<ToastApi>({ toast: () => {} });

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (msg: string, kind: ToastKind = 'info') => {
      const id = ++counter;
      setToasts((t) => [...t, { id, msg, kind }]);
      setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[2147483647] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto cursor-pointer animate-slide-up rounded-xl px-4 py-2.5 text-sm font-medium shadow-float ${
              t.kind === 'error'
                ? 'bg-red-600 text-white'
                : t.kind === 'success'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-ink text-surface'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
