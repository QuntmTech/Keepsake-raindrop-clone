from pathlib import Path

SAVE = Path('lib/save.ts')
BACKGROUND = Path('entrypoints/background.ts')
OFFSCREEN = Path('entrypoints/offscreen/main.ts')
STUDIO = Path('entrypoints/studio/App.tsx')


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one {label}, found {count}')
    return source.replace(old, new, 1)

save = SAVE.read_text()
save = replace_once(
    save,
    "  filename: string;\n  durationMs?: number;",
    "  filename: string;\n  width?: number; // native screenshot pixels — avoids decoding twice in Studio\n  height?: number;\n  durationMs?: number;",
    'Studio dimensions',
)
SAVE.write_text(save)

background = BACKGROUND.read_text()
background = replace_once(
    background,
    "      const dataUrl = await captureValidatedPng(tab.windowId);\n      await openStudio({\n        kind: 'screenshot',\n        blob: dataUrlToBlob(dataUrl),\n        pageUrl: tab.url,\n        pageTitle: tab.title,\n        filename: screenshotFilename('visible'),",
    "      const captured = await captureValidatedPng(tab.windowId);\n      await openStudio({\n        kind: 'screenshot',\n        blob: dataUrlToBlob(captured.dataUrl),\n        pageUrl: tab.url,\n        pageTitle: tab.title,\n        filename: screenshotFilename('visible'),\n        width: captured.analysis.width,\n        height: captured.analysis.height,",
    'visible dimensions',
)
background = replace_once(
    background,
    "      const source = await captureValidatedPng(tab.windowId);\n      const cropped = await cropImage(source, selection);",
    "      const { dataUrl: source } = await captureValidatedPng(tab.windowId);\n      const cropped = await cropImage(source, selection);",
    'region source capture',
)
background = replace_once(
    background,
    "        filename: screenshotFilename(msg.mode),\n      });",
    "        filename: screenshotFilename(msg.mode),\n        width: analysis.width,\n        height: analysis.height,\n      });",
    'region dimensions',
)
background = replace_once(
    background,
    "async function captureValidatedPng(windowId?: number): Promise<string> {\n  let last = '';",
    "async function captureValidatedPng(windowId?: number): Promise<{ dataUrl: string; analysis: ImageAnalysis }> {\n  let last = '';",
    'validated capture result type',
)
background = replace_once(
    background,
    "    const analysis = await analyzeImage(last);\n    if (!analysis.blank) return last;",
    "    const analysis = await analyzeImage(last);\n    if (!analysis.blank) return { dataUrl: last, analysis };",
    'validated capture result',
)
background = replace_once(
    background,
    "    filename,\n  });",
    "    filename,\n    width: analysis.width,\n    height: analysis.height,\n  });",
    'full dimensions',
)
background = replace_once(
    background,
    "  filename: string;\n  durationMs?: number;",
    "  filename: string;\n  width?: number;\n  height?: number;\n  durationMs?: number;",
    'openStudio dimensions',
)
background = replace_once(
    background,
    "  if (!started?.ok) throw new Error(started?.error || 'The recorder could not start');",
    "  if (!started?.ok) {\n    await browser.action.setBadgeText({ text: '' });\n    throw new Error(started?.error || 'The recorder could not start');\n  }",
    'recording start badge cleanup',
)
BACKGROUND.write_text(background)

studio = STUDIO.read_text()
old = '''      const megabytes = next.blob.size / (1024 * 1024);
      if (next.kind === 'screenshot') {
        try {
          const bitmap = await createImageBitmap(next.blob);
          const megapixels = (bitmap.width * bitmap.height) / 1_000_000;
          setMediaInfo(`${bitmap.width.toLocaleString()} × ${bitmap.height.toLocaleString()} px · ${megapixels.toFixed(1)} MP · ${megabytes.toFixed(1)} MB`);
          bitmap.close();
        } catch {
          setMediaInfo(`${megabytes.toFixed(1)} MB · ${next.blob.type || 'image'}`);
        }
      } else {'''
new = '''      const megabytes = next.blob.size / (1024 * 1024);
      if (next.kind === 'screenshot') {
        if (next.width && next.height) {
          const megapixels = (next.width * next.height) / 1_000_000;
          setMediaInfo(`${next.width.toLocaleString()} × ${next.height.toLocaleString()} px · ${megapixels.toFixed(1)} MP · ${megabytes.toFixed(1)} MB`);
        } else {
          // Older parked captures have no dimensions. Do not decode the giant
          // bitmap a second time just for a label; the editor owns the one decode.
          setMediaInfo(`${megabytes.toFixed(1)} MB · ${next.blob.type || 'image'}`);
        }
      } else {'''
studio = replace_once(studio, old, new, 'single screenshot decode')
STUDIO.write_text(studio)

offscreen = OFFSCREEN.read_text()
start = offscreen.index('async function startRecording(streamId: string, options: RecordOptions): Promise<void> {')
end = offscreen.index('function pauseRecording(): void {')
if start < 0 or end < 0 or end <= start:
    raise RuntimeError('Could not locate recorder start function')
start_fn = r'''async function startRecording(streamId: string, options: RecordOptions): Promise<void> {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') throw new Error('Already recording');
  await cleanup();
  try {
    const profile = resolveRecordProfile(options.quality, options.fps);
    const source = options.mode === 'desktop' ? 'desktop' : 'tab';
    const constraints: any = {
      audio: options.systemAudio
        ? { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId } }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: source,
          chromeMediaSourceId: streamId,
          maxWidth: profile.width,
          maxHeight: profile.height,
          maxFrameRate: profile.fps,
        },
      },
    };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

    recorderStream = new MediaStream();
    const videoTrack = mediaStream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('No video track available for recording');
    recorderStream.addTrack(videoTrack);
    for (const track of await buildAudioTracks(options)) {
      if (!recorderStream.getAudioTracks().some((current) => current.id === track.id)) recorderStream.addTrack(track);
    }

    const codecs = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = codecs.find((value) => MediaRecorder.isTypeSupported(value)) ?? 'video/webm';
    recordedChunks = [];
    startTime = Date.now();
    pausedAt = 0;
    pausedDurationMs = 0;
    mediaRecorder = new MediaRecorder(recorderStream, { mimeType, videoBitsPerSecond: profile.bitrate });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onerror = (event) => {
      const message = (event as Event & { error?: DOMException }).error?.message || 'Recorder failed';
      cleanup()
        .catch(() => {})
        .finally(() => chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: message }).catch(() => {}));
    };

    const onTrackEnd = () => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        stopRecording().catch((error) =>
          chrome.runtime.sendMessage({ type: 'KS_RECORDING_ERROR', error: (error as Error)?.message || 'Stop failed' }).catch(() => {}),
        );
      }
    };
    mediaStream.getTracks().forEach((track) => track.addEventListener('ended', onTrackEnd, { once: true }));
    mediaRecorder.start(1000);
  } catch (error) {
    await cleanup();
    throw error;
  }
}

'''
offscreen = offscreen[:start] + start_fn + offscreen[end:]
offscreen = replace_once(
    offscreen,
    "  if (!(response as { ok?: boolean } | null)?.ok) {\n    const anchor = document.createElement('a');\n    anchor.href = url;\n    anchor.download = filename.split('/').pop() ?? 'keepsake-recording.webm';\n    document.body.appendChild(anchor);\n    anchor.click();\n    anchor.remove();\n  }",
    "  if (!(response as { ok?: boolean } | null)?.ok) {\n    const anchor = document.createElement('a');\n    anchor.href = url;\n    anchor.download = filename.split('/').pop() ?? 'keepsake-recording.webm';\n    document.body.appendChild(anchor);\n    anchor.click();\n    anchor.remove();\n  }\n  setTimeout(() => URL.revokeObjectURL(url), 60_000);",
    'recording URL cleanup',
)
OFFSCREEN.write_text(offscreen)

Path(__file__).unlink(missing_ok=True)
