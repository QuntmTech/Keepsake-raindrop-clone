# Capture Studio 8.13

## Goals

- Never open a knowingly blank screenshot in Capture Studio.
- Preserve native browser pixels for visible, region, element, and full-page captures.
- Support app-shell pages that use fixed preview panes, iframes, and nested scrolling containers.
- Keep recording usable across popup closes and service-worker restarts.
- Give users explicit recording quality, FPS, audio, countdown, pause, and resume controls.

## Screenshot pipeline

1. `captureVisibleTab({ format: 'png' })` provides the real browser bitmap.
2. The offscreen document decodes and samples the bitmap before Studio opens.
3. Blank/transparent/all-white/all-black frames retry automatically.
4. Region and element selection happen inside the page, then the offscreen document crops the native-resolution bitmap using the actual capture-to-CSS scale.
5. Full-page capture detects a dominant nested scroller when the document itself does not scroll.
6. Compact fixed overlays are suppressed, but large fixed app shells and iframe/video/canvas containers are preserved.
7. Each viewport tile is paced, retried, decoded with a deadline, and stitched at native device scale unless Chrome canvas limits require high-quality downscaling.
8. A final validation pass runs before the image is saved or the editor opens.

## Recording pipeline

- Tab capture uses `chrome.tabCapture.getMediaStreamId()` and records in the MV3 offscreen document.
- Desktop mode uses Chrome's screen/window picker.
- Profiles: 720p, 1080p, 1440p, and 4K at 30 or 60 FPS.
- Bitrate scales with pixels per second and remains bounded.
- Tab audio is mixed into the recording and routed back to speakers so capture does not mute playback.
- Microphone audio uses echo cancellation and noise suppression.
- Pause/resume updates both the recorder and persisted extension state.
- Final blobs are validated before Studio opens, with a direct-download fallback if the background handoff fails.

## Known browser boundaries

Chrome-owned pages such as `chrome://extensions` and the Chrome Web Store block injected selection/full-page scripts. Visible-area capture may still work after a direct user gesture, but region/element/full-page tools must show a clear error instead of pretending success.
