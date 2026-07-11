# Open Screen Studio

Open Screen Studio is a local-first Chrome recorder and editor for polished product demos. It records the **website viewport only**—not Chrome's tabs, address bar, bookmarks, or menus—and keeps cursor/click data separate from the raw video so cursor movement, visibility, and camera motion stay editable after recording.

The project is an independent, open-source implementation inspired by the interaction model of [Screen Studio](https://screen.studio/). It is not affiliated with Screen Studio.

## Product model

The reference product is best understood as a recorder plus an opinionated automatic video editor:

- The raw screen image and cursor telemetry are captured separately.
- Cursor samples are resampled and smoothed for deliberate, natural motion.
- Clicks create automatic zoom ranges; manual zooms can be added on the timeline.
- The virtual camera eases between zoom states, follows the pointer with a dead zone, and stays inside the source bounds.
- Cursor size, idle hiding, and visibility remain editable after recording.
- Background, spacing, aspect ratio, corner radius, shadow, and export settings are project-level choices.

Official reference material used for this specification:

- [Screen Studio product overview](https://screen.studio/)
- [Automatic zoom behavior](https://screen.studio/guide/auto-zoom)
- [Adding and editing zooms](https://screen.studio/guide/adding-editing-zooms)
- [Cursor controls](https://screen.studio/guide/cursor)
- [Animation controls](https://screen.studio/guide/animations)
- [Cropping recordings](https://screen.studio/guide/cropping-the-recording)
- [Export settings](https://screen.studio/guide/explanation-of-export-settings)

## Scope

The first complete release covers the requested core workflow:

1. Focus any normal `http://` or `https://` Chrome tab.
2. Click the extension action and wait for the three-second countdown.
3. Interact with the website while the tab content and pointer telemetry are recorded.
4. Click the action again to stop and open the editor.
5. Preview or adjust automatic/manual zooms, cursor smoothing/size, follow behavior, framing, and trim points.
6. Add one or more timeline ranges where the cursor should be hidden; drag or resize those ranges after recording.
7. Export the composited result as a WebM video.

Intentionally out of scope: webcam/talking-head bubbles, cloud sharing, accounts, transcription, microphone enhancement, and system-wide desktop capture.

## Why a Chrome extension

An operating-system window recording includes Chrome's toolbar. Chrome's [`tabCapture`](https://developer.chrome.com/docs/extensions/reference/api/tabCapture) API instead returns the active tab's visible content surface. Starting with Chrome 116, a user gesture can create a tab stream in the service worker and consume it from an [offscreen document](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture), allowing capture to continue while the user interacts with the page.

A content script records normalized pointer/click samples at the same time. The raw capture suppresses the page cursor and the editor draws a high-resolution synthetic cursor later. This is what makes smoothing, resizing, click effects, idle hiding, and section-level cursor hiding possible without changing the raw pixels.

```mermaid
flowchart LR
    A["Chrome tab content"] -->|tabCapture stream| B["Offscreen recorder"]
    C["Pointer + click events"] -->|normalized telemetry| B
    B -->|chunked WebM| D["IndexedDB project store"]
    B -->|events + metadata| D
    D --> E["Timeline editor"]
    E --> F["Shared frame compositor"]
    F --> G["Preview"]
    F --> H["WebM export"]
```

## Project data

Projects are non-destructive. The extension stores these pieces locally:

```text
raw WebM recording
timestamped normalized cursor/click/viewport events
trim bounds
automatic and manual zoom ranges
cursor-hidden timeline ranges
cursor, camera, frame, and export settings
```

Preview and export use the same pure frame calculations so the saved result matches the editor. Recording chunks are written to IndexedDB while recording instead of being retained as one growing in-memory buffer.

## Quick start

Requirements: Chrome 116+ and Node.js 20.19+.

```bash
npm install
npm run build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository's `dist` directory.
4. Pin **Open Screen Studio**.
5. Focus the website tab you want to record and click the extension icon.
6. Click the icon again to stop.

All recording and editing data stays in the extension's local browser storage. No server, login, or network upload is used.

## Development commands

```bash
npm run dev        # rebuild the extension when source files change
npm run build      # type-check and create dist/
npm run typecheck  # TypeScript only
npm test           # unit and component tests
npm run test:watch
```

After a development rebuild, press **Reload** on the extension card in `chrome://extensions`. Reloading the extension while a capture is active ends that capture.

## Expected limitations

- Chrome internal pages, the Chrome Web Store, browser permission prompts, browser autocomplete popovers, and DRM-protected video cannot be captured or instrumented.
- The initial build targets the top-level page. Pointer tracking inside deeply nested cross-origin iframes may be incomplete.
- Export is real-time and WebM-first because it uses Chrome's native `MediaRecorder`; MP4 transcoding is not bundled.
- Closing the recorded tab ends its media stream. Navigation is supported on ordinary pages, but unusual page security policies can affect telemetry reinjection.
- Very long recordings depend on available browser storage and disk quota.

## Privacy and permissions

The extension requests tab capture, offscreen recording, downloads, local storage, and page-script access on normal web URLs. Page access is used only to collect pointer/click/viewport events during an active recording and to temporarily hide the native page cursor. It does not collect keystroke contents, form values, cookies, page source, or browsing history.

## Status

Version 0.1 implements the full local record → edit → export workflow. The
production extension has been validated in Chrome with a real tab capture,
pointer/click telemetry, generated auto zoom, persisted cursor-hidden range,
project reopen, and a 1920×1080 VP9/Opus export. Acceptance criteria are tracked
in [PLAN.md](./PLAN.md).

Released under the [MIT License](./LICENSE).
