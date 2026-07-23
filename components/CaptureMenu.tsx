import { useEffect, useRef, useState } from 'react';
import { send } from '@/lib/messaging';
import {
  capturePreferencesStore,
  DEFAULT_CAPTURE_PREFERENCES,
  IDLE_RECORDING_STATE,
  normalizeRecordingState,
  recordingStateStore,
  type CapturePreferences,
  type RecordingState,
  type RecordMode,
} from '@/lib/capture';
import { captureTier } from '@/lib/entitlements';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { UpgradeDialog } from './UpgradeDialog';

// Screenshot + recording launcher shared by the popup and Home. Capture work
// continues in the background/offscreen document after this menu closes.
export function CaptureMenu({ buttonClass = 'btn-ghost px-2.5 text-sm' }: { buttonClass?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<CapturePreferences>(DEFAULT_CAPTURE_PREFERENCES);
  const [rec, setRec] = useState<RecordingState>(IDLE_RECORDING_STATE);
  const [elapsed, setElapsed] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    capturePreferencesStore.getValue().then((value) => setPrefs({ ...DEFAULT_CAPTURE_PREFERENCES, ...value }));
    return capturePreferencesStore.watch((value) => setPrefs({ ...DEFAULT_CAPTURE_PREFERENCES, ...(value ?? {}) }));
  }, []);
  useEffect(() => {
    send<RecordingState>({ type: 'KS_GET_RECORDING_STATE' }).then((value) => setRec(normalizeRecordingState(value))).catch(() => {});
    return recordingStateStore.watch((value) => setRec(normalizeRecordingState(value)));
  }, []);
  useEffect(() => {
    if (!rec.isRecording || !rec.startedAt) {
      setElapsed('');
      return;
    }
    const tick = () => {
      const pausedNow = rec.paused && rec.pausedAt ? Date.now() - rec.pausedAt : 0;
      const seconds = Math.max(0, Math.floor((Date.now() - rec.startedAt - rec.pausedDurationMs - pausedNow) / 1000));
      setElapsed(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [rec]);

  async function setPreference(patch: Partial<CapturePreferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    await capturePreferencesStore.setValue(next);
  }

  async function run(fn: () => Promise<unknown>, failMsg: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await fn();
    } catch (error) {
      toast((error as Error)?.message || failMsg, 'error');
    } finally {
      busyRef.current = false;
    }
  }

  const screenshot = (type: 'visible' | 'region' | 'element') =>
    run(async () => {
      setOpen(false);
      const response =
        type === 'visible'
          ? await send<{ ok: boolean; error?: string }>({ type: 'KS_CAPTURE_VISIBLE' })
          : await send<{ ok: boolean; cancelled?: boolean; error?: string }>({ type: 'KS_CAPTURE_REGION', mode: type });
      if (!response?.ok && !('cancelled' in response && response.cancelled)) throw new Error(response?.error || 'Could not capture this page');
    }, 'Could not capture this page');

  const shotFull = () =>
    run(async () => {
      if ((await captureTier()) !== 'full') {
        setOpen(false);
        setShowUpgrade(true);
        return;
      }
      setOpen(false);
      const response = await send<{ ok: boolean; error?: string }>({ type: 'KS_CAPTURE_FULL' });
      if (!response?.ok) throw new Error(response?.error || 'Could not capture the full page');
      toast('Ultra HD full-page capture started — the editor opens when it is ready', 'info');
      if (location.pathname.endsWith('popup.html')) window.close();
    }, 'Full-page capture only works on regular web pages');

  const record = (mode: RecordMode) =>
    run(async () => {
      const response = await send<{ ok: boolean; error?: string }>({
        type: 'KS_START_RECORDING',
        options: {
          mode,
          microphone: prefs.microphone,
          systemAudio: prefs.systemAudio,
          quality: prefs.quality,
          fps: prefs.fps,
          countdownSeconds: prefs.countdownSeconds,
        },
      });
      if (!response?.ok) throw new Error(response?.error || 'Could not start recording');
      setOpen(false);
      toast(`Recording started · ${prefs.quality} ${prefs.fps} FPS`, 'success');
    }, 'Could not start recording');

  const pauseOrResume = () =>
    run(async () => {
      const response = await send<{ ok: boolean; error?: string }>({ type: rec.paused ? 'KS_RESUME_RECORDING' : 'KS_PAUSE_RECORDING' });
      if (!response?.ok) throw new Error(response?.error || 'Could not update the recording');
      toast(rec.paused ? 'Recording resumed' : 'Recording paused', 'info');
    }, 'Could not update the recording');

  const stop = () =>
    run(async () => {
      const response = await send<{ ok: boolean; error?: string }>({ type: 'KS_STOP_RECORDING' });
      if (!response?.ok) throw new Error(response?.error || 'Could not stop recording');
      setOpen(false);
      toast('Finalizing the recording — the editor will open shortly', 'success');
    }, 'Could not stop the recording');

  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink hover:bg-surface-sunken';

  return (
    <div className="relative">
      <button
        className={`${buttonClass} ${rec.isRecording ? 'text-red-500' : ''}`}
        onClick={() => setOpen((current) => !current)}
        title={rec.isRecording ? `${rec.paused ? 'Paused' : 'Recording'} · ${elapsed}` : 'Capture Studio'}
      >
        {rec.isRecording ? (
          <>
            <span className={`inline-block h-2 w-2 rounded-full bg-red-500 ${rec.paused ? '' : 'animate-pulse'}`} />
            {rec.paused ? 'Paused' : elapsed || 'REC'}
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
          <div className="absolute right-0 top-full z-20 mt-1 w-80 rounded-xl border border-line bg-surface-raised p-2 shadow-float">
            {rec.isRecording ? (
              <>
                <div className="mb-1 rounded-lg bg-red-500/10 px-3 py-2">
                  <p className="text-sm font-semibold text-red-500">{rec.paused ? 'Recording paused' : 'Recording in progress'} · {elapsed}</p>
                  <p className="text-[11px] text-ink-faint">{rec.quality} · {rec.fps} FPS · {rec.mode === 'tab' ? 'This tab' : 'Screen/window'}</p>
                </div>
                <button className={item} onClick={pauseOrResume}>
                  <Icon name={rec.paused ? 'play' : 'pause'} size={16} /> {rec.paused ? 'Resume recording' : 'Pause recording'}
                </button>
                <button className={`${item} text-red-500`} onClick={stop}>
                  <span className="grid h-4 w-4 place-items-center"><span className="h-2.5 w-2.5 rounded-[3px] bg-red-500" /></span>
                  Stop and open editor
                </button>
              </>
            ) : (
              <>
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Screenshot · native resolution</p>
                <button className={item} onClick={() => screenshot('visible')}>
                  <Icon name="camera" size={16} /> Visible area
                  <span className="ml-auto text-[10px] text-ink-faint">Fast</span>
                </button>
                <button className={item} onClick={() => screenshot('region')}>
                  <Icon name="crop" size={16} /> Select an area
                </button>
                <button className={item} onClick={() => screenshot('element')}>
                  <Icon name="box" size={16} /> Pick an element
                </button>
                <button className={item} onClick={shotFull}>
                  <Icon name="image" size={16} /> Full page / scrolling pane
                  <span className="ml-auto text-[10px] font-semibold text-brand">UHD</span>
                </button>
                <p className="px-2.5 pb-1 text-[11px] text-ink-faint">Blank frames retry automatically. App shells and embedded previews are preserved.</p>

                <div className="mx-2 my-2 h-px bg-line" />
                <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Screen recording</p>
                <div className="grid grid-cols-2 gap-2 px-2.5 pb-2">
                  <label className="text-[11px] font-medium text-ink-soft">
                    Quality
                    <select className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink" value={prefs.quality} onChange={(event) => setPreference({ quality: event.target.value as CapturePreferences['quality'] })}>
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                      <option value="1440p">1440p</option>
                      <option value="4k">4K Ultra HD</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-ink-soft">
                    Frame rate
                    <select className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink" value={prefs.fps} onChange={(event) => setPreference({ fps: Number(event.target.value) as CapturePreferences['fps'] })}>
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                    </select>
                  </label>
                </div>
                <button className={item} onClick={() => record('tab')}>
                  <Icon name="record" size={16} /> Record this tab
                </button>
                <button className={item} onClick={() => record('desktop')}>
                  <Icon name="monitor" size={16} /> Record screen or window…
                </button>
                <div className="grid grid-cols-2 gap-x-2 px-2.5 pt-1">
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-xs text-ink-soft">
                    <input type="checkbox" checked={prefs.microphone} onChange={(event) => setPreference({ microphone: event.target.checked })} />
                    <Icon name="mic" size={13} /> Mic
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 py-1 text-xs text-ink-soft">
                    <input type="checkbox" checked={prefs.systemAudio} onChange={(event) => setPreference({ systemAudio: event.target.checked })} />
                    <Icon name="video" size={13} /> System audio
                  </label>
                </div>
                <label className="mt-1 flex items-center justify-between px-2.5 py-1 text-xs text-ink-soft">
                  Countdown
                  <select className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink" value={prefs.countdownSeconds} onChange={(event) => setPreference({ countdownSeconds: Number(event.target.value) as CapturePreferences['countdownSeconds'] })}>
                    <option value={0}>None</option>
                    <option value={3}>3 seconds</option>
                    <option value={5}>5 seconds</option>
                  </select>
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
