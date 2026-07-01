// Offscreen recorder (ported from CaptureCraft's offscreen.js). The background
// worker acquires a stream id (tabCapture / desktopCapture) and sends it here;
// this document turns it into a MediaStream, mixes in the microphone if asked,
// runs MediaRecorder, and on stop mints a blob: URL for the background to
// download. Blobs can't cross the message boundary (JSON serialization), but a
// blob: URL string can — and it stays valid while this document lives.

import { recordingFilename, type OffscreenCommand, type RecordOptions } from '@/lib/capture';

let mediaStream: MediaStream | null = null; // raw capture stream
let microphoneStream: MediaStream | null = null;
let recorderStream: MediaStream | null = null; // what MediaRecorder consumes
let audioContext: AudioContext | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let startTime = 0;

const QUALITY = { width: 1920, height: 1080, fps: 30, bitrate: 8_000_000 };

chrome.runtime.onMessage.addListener((msg: OffscreenCommand, _sender, sendResponse) => {
  if (msg?.target !== 'ks-offscreen') return;
  (async () => {
    switch (msg.type) {
      case 'OFFSCREEN_START':
        await startRecording(msg.streamId, msg.options);
        return { ok: true };
      case 'OFFSCREEN_STOP':
        await stopRecording();
        return { ok: true };
      default:
        return { ok: false };
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: (e as Error)?.message || String(e) }));
  return true; // async response
});

// System audio comes with the capture stream; the microphone is a separate
// getUserMedia stream. When both are on, mix them through WebAudio into one
// track (a MediaRecorder can only record a single audio track).
async function buildAudioTracks(options: RecordOptions): Promise<MediaStreamTrack[]> {
  const systemTracks = options.systemAudio ? mediaStream?.getAudioTracks() ?? [] : [];
  if (!options.microphone) return systemTracks;
  microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const micTracks = microphoneStream.getAudioTracks();
  if (!systemTracks.length) return micTracks;
  audioContext = new AudioContext();
  const dest = audioContext.createMediaStreamDestination();
  audioContext.createMediaStreamSource(new MediaStream(systemTracks)).connect(dest);
  if (micTracks.length) audioContext.createMediaStreamSource(new MediaStream(micTracks)).connect(dest);
  return dest.stream.getAudioTracks();
}

async function startRecording(streamId: string, options: RecordOptions): Promise<void> {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') throw new Error('Already recording');
  await cleanup();

  const source = options.mode === 'desktop' ? 'desktop' : 'tab';
  // chromeMediaSource constraints are Chrome-only and untyped.
  const constraints: any = {
    audio: options.systemAudio
      ? { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId } }
      : false,
    video: {
      mandatory: {
        chromeMediaSource: source,
        chromeMediaSourceId: streamId,
        maxWidth: QUALITY.width,
        maxHeight: QUALITY.height,
        maxFrameRate: QUALITY.fps,
      },
    },
  };
  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

  recorderStream = new MediaStream();
  const videoTrack = mediaStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('No video track available for recording');
  recorderStream.addTrack(videoTrack);
  for (const track of await buildAudioTracks(options)) {
    try {
      recorderStream.addTrack(track);
    } catch {
      /* duplicate track */
    }
  }

  // Negotiate the best supported codec, newest first.
  const codecs = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
  const mimeType = codecs.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

  recordedChunks = [];
  startTime = Date.now();
  mediaRecorder = new MediaRecorder(recorderStream, { mimeType, videoBitsPerSecond: QUALITY.bitrate });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onerror = () => {
    chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: 'Recorder failed' }).catch(() => {});
  };

  // The user can end the capture from Chrome's own "stop sharing" UI — treat
  // that exactly like pressing Stop, or the extension stays stuck recording.
  const onTrackEnd = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      stopRecording().catch((e) =>
        chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: (e as Error)?.message || 'Stop failed' }).catch(() => {}),
      );
    }
  };
  mediaStream.getTracks().forEach((t) => t.addEventListener('ended', onTrackEnd, { once: true }));

  // 1s timeslice keeps memory bounded on long recordings.
  mediaRecorder.start(1000);
}

async function stopRecording(): Promise<void> {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') throw new Error('No active recording');
  const recorder = mediaRecorder;
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
  recorder.stop();
  await stopped;

  const mimeType = recorder.mimeType || 'video/webm';
  const blob = new Blob(recordedChunks, { type: mimeType });
  const durationMs = Date.now() - startTime;
  const url = URL.createObjectURL(blob); // stays alive with this document — do not revoke before download
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

  await cleanup();

  const filename = recordingFilename(startTime, ext);
  const resp = await chrome.runtime
    .sendMessage({ type: 'KS_RECORDING_READY', url, filename, size: blob.size, durationMs })
    .catch(() => null);
  if (!(resp as { ok?: boolean } | null)?.ok) {
    // Background couldn't run downloads.download — save straight from this
    // document instead (an anchor click needs no extra permissions).
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.split('/').pop() ?? 'keepsake-recording.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

async function cleanup(): Promise<void> {
  for (const stream of [recorderStream, mediaStream, microphoneStream]) {
    stream?.getTracks().forEach((t) => t.stop());
  }
  recorderStream = mediaStream = microphoneStream = null;
  mediaRecorder = null;
  recordedChunks = [];
  if (audioContext) {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }
}
