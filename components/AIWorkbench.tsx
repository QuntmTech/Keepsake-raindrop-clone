import { useState } from 'react';
import { AIWriter } from './AIWriter';
import { AIAssistant } from './AIAssistant';

export function AIWorkbench({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [mode, setMode] = useState<'write' | 'ask'>('write');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="grid grid-cols-2 border-b border-line bg-surface-raised p-1.5">
        <button
          className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
            mode === 'write' ? 'bg-brand text-white shadow-sm' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
          }`}
          onClick={() => setMode('write')}
        >
          Write
        </button>
        <button
          className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
            mode === 'ask' ? 'bg-brand text-white shadow-sm' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
          }`}
          onClick={() => setMode('ask')}
        >
          Ask library
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'write' ? <AIWriter onOpenSettings={onOpenSettings} /> : <AIAssistant />}
      </div>
    </div>
  );
}
