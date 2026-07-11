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
- [x] Use `chrome.tabCapture.getMediaStreamId()` plus an offscreen document so only the active tab viewport is recorded.
- [x] Capture tab audio when available and keep it audible locally during recording.
- [x] Track normalized pointer moves, clicks, pointer visibility, and viewport changes separately.
- [x] Remove the native page cursor from the raw capture and restore it reliably on stop/error.
- [x] Persist one-second MediaRecorder chunks incrementally in IndexedDB.
- [x] Handle stop, tab closure, capture-track termination, restricted pages, and recorder errors without leaving stale UI.

Acceptance:

- The recording contains website pixels but no Chrome address bar/tab strip.
- Clicking the action a second time finalizes a project and opens it in the editor.
- The source tab's cursor styling is restored even after a failed start or normal stop.

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
- [x] Export the trimmed range at selectable size/FPS/quality as WebM.
- [x] Show progress, support cancellation, choose a safe filename, and download the result.
- [x] Keep preview and export output visually consistent.

Acceptance:

- A recorded project can be edited and downloaded without an external service.
- The downloaded file has non-zero duration, expected dimensions, and the selected effects.
- Cursor-hidden ranges are absent in the exported frames, not just the preview.

## 6. Validation and delivery

- [x] Add tests for reducers/storage migrations and critical editor interactions.
- [x] Test the production build in an unpacked Chrome extension.
- [x] Verify start/stop, pointer capture, auto zoom, manual zoom, follow, cursor hiding, project reopen, and export.
- [x] Review permission copy, error states, empty states, and the README startup path.
- [ ] Open a GitHub PR with the complete diff, merge it into `main`, and verify the merged branch.

## Definition of done

The application is done when a new user can follow the README from a clean checkout, record a normal Chrome tab without browser chrome, hide the cursor for chosen timeline sections, preview smooth cursor/camera effects, export the finished recording, and reopen the saved project—all locally.
