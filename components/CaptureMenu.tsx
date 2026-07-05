import { useEffect, useRef, useState } from 'react';
import { send } from '@/lib/messaging';
import { recordingStateStore, type RecordingState, type RecordMode, IDLE_RECORDING_STATE } from '@/lib/capture';
import { captureTier } from '@/lib/entitlements';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { UpgradeDialog } from './UpgradeDialog';

// Capture dropdown (screenshots + screen recording), shown in the popup and on
// Home. The heavy lifting happens in the background worker + offscreen
// document, so recordings keep running after this UI closes.
export function CaptureMenu({ buttonClass = 'btn-ghost px-2.5 text-sm' }: { buttonClass?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mic, setMic] = useState(false);
  const [systemAudio, setSystemAudio] = useState(true);
  const [rec, setRec] = useState<RecordingState>(IDLE_RECORDING_STATE);
  const [elapsed, setElapsed] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const busyRef = useRef(false);

  // Live recording state: initial fetch (verified against the offscreen doc)
  // + storage watch so every surface updates the moment recording starts/stops.
  useEffect(() => {
    send<RecordingState>({ type: 'KS_GET_RECORDING_STATE' }).then(setRec).catch(() => {});
    return recordingStateStore.watch((s) => setRec(s ?? IDLE_RECORDING_STATE));
  }, []);
  useEffect(() => {
    if (!rec.isRecording || !rec.startedAt) {
      setElapsed('');
      return;
    }
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - rec.startedAt!) / 1000));
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [rec.isRecording, rec.startedAt]);

  async function run(fn: () => Promise<unknown>, failMsg: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await fn();
    } catch (e) {
      toast((e as Error)?.message || failMsg, 'error');
    } finally {
      busyRef.current = false;
    }
  }

  // Screenshots open in the Capture Studio: annotate/crop there, then copy,
  // download, or keep the library copy — one flow for every capture.
  const shotVisible = () =>
    run(async () => {
      setOpen(false);
      const r = await send<{ ok: boolean; error?: string }>({ type: 'KS_CAPTURE_VISIBLE' });
      if (!r?.ok) throw new Error(r?.error || 'Could not capture');
    }, 'Could not capture this tab');

  const shotFull = () =>
    run(async () => {
      // Full-page capture is a Pro perk (full Capture Studio tier); Free stays
      // on the basic single-area screenshot above.
      if ((await captureTier()) !== 'full') {
        setOpen(false);
        setShowUpgrade(true);
        return;
      }
      setOpen(false);
      const r = await send<{ ok: boolean; error?: string }>({ type: 'KS_CAPTURE_FULL' });
      if (!r?.ok) throw new Error(r?.error || 'Could not capture');
      toast('Capturing the full page — it will open in the editor when done', 'info');
      // The popup can close now; the capture keeps running in the tab.
      if (location.pathname.endsWith('popup.html')) window.close();
    }, 'Full-page capture only works on regular web pages');

  const record = (mode: RecordMode) =>
    run(async () => {
      const r = await send<{ ok: boolean; error?: string }>({
        type: 'KS_START_RECORDING',
        options: { mode, microphone: mic, systemAudio },
      });
      if (!r?.ok) throw new Error(r?.error || 'Could not start recording');
      setOpen(false);
      toast('Recording started', 'success');
    }, 'Could not start recording');

  const stop = () =>
    run(async () => {
      const r = await send<{ ok: boolean; error?: string }>({ type: 'KS_STOP_RECORDING' });
      if (!r?.ok) throw new Error(r?.error || 'Could not stop');
      setOpen(false);
      toast('Recording stopped — opening in the editor', 'success');
    }, 'Could not stop the recording');

  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-surface-sunken';

  return (
    <div className="relative">
      <button
        className={`${buttonClass} ${rec.isRecording ? 'text-red-500' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={rec.isRecording ? `Recording… ${elapsed}` : 'Capture: screenshot or screen recording'}
      >
        {rec.isRecording ? (
          <>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" /> {elapsed || 'REC'}
          </>
        ) : (
          <>
            <Icon name="camera" size={17} /> Capture
          </>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-line bg-surface-raised p-2 shadow-float">
            {rec.isRecording ? (
              <button className={`${item} text-red-500`} onClick={stop}>
                <span className="grid h-4 w-4 place-items-center">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-red-500" />
                </span>
                Stop recording {elapsed && `(${elapsed})`}
              </button>
            ) : (
              <>
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Screenshot</p>
                <button className={item} onClick={shotVisible}>
                  <Icon name="camera" size={16} /> Visible area
                </button>
                <button className={item} onClick={shotFull}>
                  <Icon name="image" size={16} /> Full page (scrolls &amp; stitches)
                </button>
                <p className="px-2.5 pb-0.5 text-[11px] text-ink-faint">
                  Opens in the editor — annotate, crop, then copy or download.
                </p>
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Record</p>
                <button className={item} onClick={() => record('tab')}>
                  <Icon name="record" size={16} /> This tab
                </button>
                <button className={item} onClick={() => record('desktop')}>
                  <Icon name="monitor" size={16} /> Screen or window…
                </button>
                <label className="mt-1 flex cursor-pointer items-center gap-2 px-2.5 py-1 text-xs text-ink-soft">
                  <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
                  <Icon name="mic" size={13} /> Microphone
                </label>
                <label className="flex cursor-pointer items-center gap-2 px-2.5 py-1 text-xs text-ink-soft">
                  <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} />
                  <Icon name="video" size={13} /> Tab / system audio
                </label>
              </>
            )}
          </div>
        </>
      )}
      {showUpgrade && <UpgradeDialog reason="capture" onClose={() => setShowUpgrade(false)} />}
    </div>
  );
}
