import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

// Recording side of the Capture Studio: a big preview player plus a trim tool.
// Trimming re-encodes by playing the selected range through captureStream +
// MediaRecorder (WebM has no cheap lossless cut), so it takes as long as the
// clip you keep — fine for the "chop the fumbling off both ends" case.

export interface VideoStudioHandle {
  exportBlob(): Promise<Blob>;
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export const VideoStudio = forwardRef<VideoStudioHandle, { blob: Blob; durationMs?: number; onEdited: () => void }>(
  function VideoStudio({ blob, durationMs, onEdited }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [working, setWorking] = useState<Blob>(blob);
    const [url, setUrl] = useState('');
    const [duration, setDuration] = useState((durationMs ?? 0) / 1000);
    const [range, setRange] = useState<[number, number] | null>(null);
    const [trimming, setTrimming] = useState(0); // 0 = idle, else 0..1 progress
    const originalRef = useRef<Blob>(blob);

    useEffect(() => {
      const u = URL.createObjectURL(working);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }, [working]);

    // MediaRecorder WebM has no duration header — read it from the element
    // (with the Infinity workaround: seek far, let it settle).
    const onMeta = () => {
      const v = videoRef.current!;
      if (isFinite(v.duration) && v.duration > 0) {
        setDuration(v.duration);
        setRange((r) => r ?? [0, v.duration]);
      } else {
        const fix = () => {
          setDuration(v.duration);
          setRange((r) => (r && isFinite(r[1]) ? r : [0, v.duration]));
          v.currentTime = 0;
          v.removeEventListener('durationchange', fix);
        };
        v.addEventListener('durationchange', fix);
        v.currentTime = 1e7;
      }
    };

    const setStart = (t: number) => {
      setRange((r) => [Math.min(t, (r?.[1] ?? duration) - 0.1), r?.[1] ?? duration]);
      if (videoRef.current) videoRef.current.currentTime = t;
    };
    const setEnd = (t: number) => {
      setRange((r) => [r?.[0] ?? 0, Math.max(t, (r?.[0] ?? 0) + 0.1)]);
      if (videoRef.current) videoRef.current.currentTime = t;
    };

    const trimmed = range && duration > 0 && (range[0] > 0.05 || range[1] < duration - 0.05);

    async function applyTrim() {
      if (!range || trimming) return;
      const [start, end] = range;
      setTrimming(0.0001);
      try {
        const out = await reencodeRange(working, start, end, (p) => setTrimming(Math.max(0.0001, p)));
        setWorking(out);
        setRange(null);
        setDuration(end - start);
        onEdited();
      } finally {
        setTrimming(0);
      }
    }

    function resetOriginal() {
      setWorking(originalRef.current);
      setRange(null);
      onEdited();
    }

    useImperativeHandle(ref, () => ({
      async exportBlob() {
        return working;
      },
    }));

    return (
      <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-auto p-6">
        <video
          ref={videoRef}
          src={url}
          controls
          className="max-h-[62vh] w-full max-w-4xl rounded-xl border border-line bg-black shadow-card"
          onLoadedMetadata={onMeta}
        />

        <div className="w-full max-w-4xl rounded-xl border border-line bg-surface-raised p-4 shadow-card">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Trim</h3>
            <span className="text-xs text-ink-faint">
              {fmt(range?.[0] ?? 0)} – {fmt(range?.[1] ?? duration)} of {fmt(duration)} ·{' '}
              {(working.size / (1024 * 1024)).toFixed(1)} MB
            </span>
          </div>

          {trimming > 0 ? (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round(trimming * 100)}%` }} />
              </div>
              <p className="mt-2 text-center text-xs text-ink-faint">
                Trimming — the clip plays through once to re-encode ({Math.round(trimming * 100)}%)…
              </p>
            </div>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <label className="text-xs text-ink-soft">
                  Start — {fmt(range?.[0] ?? 0)}
                  <input
                    type="range"
                    className="mt-1 w-full accent-[rgb(var(--accent))]"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={range?.[0] ?? 0}
                    onChange={(e) => setStart(Number(e.target.value))}
                  />
                </label>
                <label className="text-xs text-ink-soft">
                  End — {fmt(range?.[1] ?? duration)}
                  <input
                    type="range"
                    className="mt-1 w-full accent-[rgb(var(--accent))]"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={range?.[1] ?? duration}
                    onChange={(e) => setEnd(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={applyTrim} disabled={!trimmed}>
                  ✂ Trim to selection
                </button>
                {working !== originalRef.current && (
                  <button className="btn-outline px-3 py-1.5 text-xs" onClick={resetOriginal}>
                    Reset to original
                  </button>
                )}
                <span className="text-[11px] text-ink-faint">
                  Drag the sliders (the player jumps there so you can aim), then trim.
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    );
  },
);

// Re-encode [start, end] of a WebM blob in real time. Audio is routed through
// WebAudio into the recorder (NOT the speakers), so trimming is silent.
async function reencodeRange(src: Blob, start: number, end: number, onProgress: (p: number) => void): Promise<Blob> {
  const v = document.createElement('video');
  v.src = URL.createObjectURL(src);
  v.preload = 'auto';
  await new Promise<void>((res, rej) => {
    v.onloadedmetadata = () => res();
    v.onerror = () => rej(new Error('Could not read the recording'));
  });
  v.currentTime = start;
  await new Promise<void>((res) => {
    v.onseeked = () => res();
  });

  const captured: MediaStream = (v as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
  const tracks: MediaStreamTrack[] = [...captured.getVideoTracks()];
  let ac: AudioContext | null = null;
  if (captured.getAudioTracks().length) {
    ac = new AudioContext();
    const node = ac.createMediaElementSource(v); // detaches audio from the speakers
    const dest = ac.createMediaStreamDestination();
    node.connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  } else {
    v.muted = true;
  }

  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
  const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const done = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType || 'video/webm' }));
  });

  rec.start(500);
  await v.play();
  await new Promise<void>((res) => {
    const tick = () => {
      onProgress(Math.min(1, (v.currentTime - start) / Math.max(0.1, end - start)));
      if (v.currentTime >= end || v.ended) {
        v.pause();
        res();
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });
  rec.stop();
  const blob = await done;
  URL.revokeObjectURL(v.src);
  ac?.close().catch(() => {});
  if (blob.size < 1024) throw new Error('Trim failed — the re-encode produced no data');
  return blob;
}
