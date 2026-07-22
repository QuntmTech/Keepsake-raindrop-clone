import { useState } from 'react';
import { setWriterDraft } from '@/lib/aiWriter';
import { type SavedPrompt } from '@/lib/promptLibrary';
import { AIAssistant } from './AIAssistant';
import { AIPageTools } from './AIPageTools';
import { AIWriter } from './AIWriter';
import { PromptLibrary } from './PromptLibrary';
import { TranscriptionPanel } from './TranscriptionPanel';

 type Mode = 'write' | 'page' | 'transcribe' | 'prompts' | 'ask';

const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'write', label: 'Write' },
  { id: 'page', label: 'Page' },
  { id: 'transcribe', label: 'Audio' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'ask', label: 'Library' },
];

export function AIWorkbench({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [mode, setMode] = useState<Mode>('write');

  async function usePrompt(prompt: SavedPrompt) {
    await setWriterDraft({
      action: 'custom',
      customInstruction: prompt.instruction,
      selectedPromptId: prompt.id,
      output: '',
    });
    setMode('write');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-line bg-surface-raised px-1.5 py-1.5">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="AI Workbench tools">
          {MODES.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={mode === item.id}
              className={`min-w-[58px] flex-1 rounded-lg px-2 py-2 text-[10px] font-semibold transition ${
                mode === item.id ? 'bg-brand text-white shadow-sm' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
              }`}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'write' && <AIWriter onOpenSettings={onOpenSettings} />}
        {mode === 'page' && <AIPageTools />}
        {mode === 'transcribe' && <TranscriptionPanel onOpenSettings={onOpenSettings} />}
        {mode === 'prompts' && <PromptLibrary onUse={usePrompt} />}
        {mode === 'ask' && <AIAssistant />}
      </div>
    </div>
  );
}
