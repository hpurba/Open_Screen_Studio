# Build plan

This plan turns the product model in `README.md` into a complete local Chrome application. A milestone is complete only when its acceptance checks pass.

## 1. Foundation

- [x] Create a Vite + React + TypeScript Manifest V3 extension.
- [x] Add stable multi-entry builds for the service worker, content script, offscreen recorder, and editor.
- [x] Add strict TypeScript, lint-friendly formatting, Vitest, and reusable project/protocol types.
- [x] Add extension icons, install onboarding, and a project library route.

Acceptance:

- `npm run typecheck`, `npm test`, and `npm run build` succeed from a clean checkout.
- `dist/manifest.json` points only to files that exist.

## 2. Content-only recording

- [x] Toggle recording from the extension action with a visible countdown and REC badge.
- [x] Use `chrome.debugger` page-screencast frames plus an offscreen canvas so only the active website viewport is recorded and the operating-system cursor is never baked in.
- [x] Keep `chrome.tabCapture.getMediaStreamId()` solely for tab audio and replay it locally during capture.
- [x] Track normalized pointer moves, clicks, pointer visibility, and viewport changes separately.
- [x] Keep the native cursor visible to the person recording without changing page cursor styles or baking it into the captured video.
- [x] Suppress recorded cursor/scroll glyphs during active scrolling.
- [x] Persist one-second MediaRecorder chunks incrementally in IndexedDB.
- [x] Handle stop, tab closure, capture-track termination, restricted pages, and recorder errors without leaving stale UI.

Acceptance:

- The recording contains website pixels but no Chrome address bar/tab strip.
- Clicking the action a second time finalizes a project and opens it in the editor.
- The source tab's cursor styling remains unchanged through countdown, recording, stop, and failure.

## 3. Effects engine

- [x] Implement cursor interpolation and centered smoothing without permanent lag.
- [x] Preserve click locations as cursor-path anchors.
- [x] Implement cursor size, idle fade, global visibility, and click ripple.
- [x] Generate sensible automatic zoom ranges from click events and merge nearby clicks.
- [x] Implement manual zoom targets, eased zoom transitions, camera following with a dead zone, and edge clamping.
- [x] Implement cursor-hidden ranges with boundary fades.
- [x] Keep all calculations pure and shared by preview/export.

Acceptance:

- Unit tests cover interpolation, click anchoring, auto-zoom generation, easing, follow-camera bounds, idle visibility, and hidden-range fades.
- At every tested timestamp, all computed source/cursor coordinates stay finite and inside valid bounds.

## 4. Editor

- [x] Build a responsive editor with video preview, transport controls, inspector, and multi-track timeline.
- [x] Display click markers and automatic/manual zoom blocks.
- [x] Add, select, drag, resize, edit, and delete zoom blocks.
- [x] Add, drag, resize, and delete cursor-hidden ranges after recording.
- [x] Support setting a manual zoom target directly on the preview.
- [x] Add cursor, camera, aspect ratio, background, padding, radius, shadow, trim, and export controls.
- [x] Auto-save project edits locally and allow prior projects to be reopened or deleted from the library.

Acceptance:

- A cursor-hidden range can cover an arbitrary section and remains editable after reload.
- Preview updates immediately for timeline and inspector changes.
- Keyboard-accessible labels exist for all essential controls.

## 5. Rendering and export

- [x] Draw background, framed/cropped video, camera zoom, smooth cursor, and click effects into one canvas.
- [x] Preserve source audio in the composited export.
- [x] Export the trimmed range at selectable format/size/FPS/quality as WebM or locally transcoded H.264/AAC MP4.
- [x] Show progress, support cancellation, choose a safe filename, and download the result.
- [x] Keep preview and export output visually consistent.

Acceptance:

- A recorded project can be edited and downloaded without an external service.
- The downloaded file has non-zero duration, expected dimensions, and the selected effects.
- MP4 conversion runs entirely inside the extension, reports its own progress phase, and remains cancellable.
- Cursor-hidden ranges are absent in the exported frames, not just the preview.

## 6. Validation and delivery

- [x] Add tests for reducers/storage migrations and critical editor interactions.
- [x] Test the production build in an unpacked Chrome extension.
- [x] Verify start/stop, the visible live cursor, cursor-free raw frames, scroll-glyph suppression, auto zoom, manual zoom, follow, cursor hiding, project reopen, and export.
- [x] Verify both VP9/Opus WebM and locally converted H.264/AAC MP4 output in Chrome.
- [x] Review permission copy, error states, empty states, and the README startup path.
- [x] Open a GitHub PR with the complete diff, merge it into `main`, and verify the merged branch.

## Definition of done

The application is done when a new user can follow the README from a clean checkout, record a normal Chrome tab without browser chrome, hide the cursor for chosen timeline sections, preview smooth cursor/camera effects, export the finished recording, and reopen the saved project—all locally.
