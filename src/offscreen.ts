import {
  containRect,
  remapToCanvas,
  type CanvasContentRect
} from "./shared/capture";
import { generateAutoZooms } from "./shared/effects";
import { createProject } from "./shared/project";
import {
  deleteProject,
  deleteRecordingChunks,
  putProject,
  putRecordingChunk
} from "./shared/storage";
import type {
  CaptureEvent,
  FailureResult,
  RecorderStartPayload,
  RecorderStartResult,
  RecorderStopResult,
  ZoomSegment
} from "./shared/types";

type RecorderResult = RecorderStopResult | FailureResult;
type PrimedResult =
  | { ok: true; width: number; height: number; mimeType: string }
  | FailureResult;

type OffscreenMessage =
  | ({ type: "OFFSCREEN_PRIME" } & RecorderStartPayload)
  | { type: "OFFSCREEN_SCREENCAST_FRAME"; sessionId: string; data: string }
  | { type: "OFFSCREEN_START"; sessionId: string }
  | { type: "OFFSCREEN_EVENT_BATCH"; sessionId: string; events: unknown[] }
  | { type: "OFFSCREEN_STOP"; sessionId: string }
  | { type: "OFFSCREEN_ABORT"; sessionId: string };

type RecordingState = {
  payload: RecorderStartPayload;
  tabStream: MediaStream;
  outputStream?: MediaStream;
  recorder?: MediaRecorder;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  canvasTrack?: CanvasCaptureMediaStreamTrack;
  framePump?: number;
  hasScreencastFrame: boolean;
  contentRect?: CanvasContentRect;
  mimeType: string;
  startedAt: number;
  width: number;
  height: number;
  events: CaptureEvent[];
  nextChunk: number;
  writeChain: Promise<void>;
  writeError?: Error;
  stopping: boolean;
  aborted: boolean;
  stopPromise: Promise<void>;
  resolveStopped: () => void;
  finalizePromise?: Promise<RecorderResult>;
  audioContext?: AudioContext;
  audioSource?: MediaStreamAudioSourceNode;
};

let activeRecording: RecordingState | undefined;

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Chrome did not allow access to this tab capture stream.";
    }
    if (error.name === "NotReadableError") {
      return "The tab capture stream is already in use or could not be read.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function isOffscreenMessage(value: unknown): value is OffscreenMessage {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  return [
    "OFFSCREEN_PRIME",
    "OFFSCREEN_SCREENCAST_FRAME",
    "OFFSCREEN_START",
    "OFFSCREEN_EVENT_BATCH",
    "OFFSCREEN_STOP",
    "OFFSCREEN_ABORT"
  ].includes(String((value as { type: unknown }).type));
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeEvent(value: unknown): CaptureEvent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const event = value as Record<string, unknown>;
  if (!finiteNumber(event.t)) return undefined;
  const t = Math.max(0, event.t);

  if (event.type === "pointer") {
    if (!finiteNumber(event.x) || !finiteNumber(event.y)) return undefined;
    const cursorKinds = new Set([
      "default",
      "pointer",
      "text",
      "grab",
      "grabbing",
      "crosshair",
      "hidden"
    ]);
    return {
      type: "pointer",
      t,
      x: clampUnit(event.x),
      y: clampUnit(event.y),
      cursor: cursorKinds.has(String(event.cursor))
        ? (event.cursor as Extract<CaptureEvent, { type: "pointer" }>["cursor"])
        : "default"
    };
  }

  if (event.type === "click") {
    if (!finiteNumber(event.x) || !finiteNumber(event.y)) return undefined;
    return {
      type: "click",
      t,
      x: clampUnit(event.x),
      y: clampUnit(event.y),
      button: finiteNumber(event.button) ? Math.round(event.button) : 0
    };
  }

  if (event.type === "viewport") {
    if (
      !finiteNumber(event.width) ||
      !finiteNumber(event.height) ||
      !finiteNumber(event.dpr)
    ) {
      return undefined;
    }
    return {
      type: "viewport",
      t,
      width: Math.max(1, Math.round(event.width)),
      height: Math.max(1, Math.round(event.height)),
      dpr: Math.max(0.1, event.dpr)
    };
  }

  if (event.type === "visibility" && typeof event.visible === "boolean") {
    return { type: "visibility", t, visible: event.visible };
  }

  return undefined;
}

function selectMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm"
  ];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? "";
}

function tabAudioConstraints(streamId: string): MediaStreamConstraints {
  const mandatory = {
    chromeMediaSource: "tab",
    chromeMediaSourceId: streamId
  };
  return {
    audio: { mandatory },
    video: false
  } as unknown as MediaStreamConstraints;
}

async function replayTabAudio(state: RecordingState): Promise<void> {
  if (state.tabStream.getAudioTracks().length === 0) return;
  try {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(state.tabStream);
    source.connect(context.destination);
    if (context.state === "suspended") await context.resume();
    state.audioContext = context;
    state.audioSource = source;
  } catch {
    // Recording remains useful if an enterprise autoplay policy blocks replay.
  }
}

function installRecorderListeners(
  state: RecordingState,
  recorder: MediaRecorder
): void {
  recorder.addEventListener("dataavailable", (event: BlobEvent) => {
    if (event.data.size === 0) return;
    const chunkIndex = state.nextChunk++;
    state.writeChain = state.writeChain.then(() =>
      putRecordingChunk(state.payload.sessionId, chunkIndex, event.data)
    );
    void state.writeChain.catch((error: unknown) => {
      state.writeError =
        error instanceof Error ? error : new Error(String(error));
      if (!state.stopping) {
        void finalizeRecording(state, "storage-error", true);
      }
    });
  });
  recorder.addEventListener(
    "stop",
    () => {
      state.resolveStopped();
    },
    { once: true }
  );
  recorder.addEventListener("error", (event: Event) => {
    const possibleError = (event as Event & { error?: DOMException }).error;
    state.writeError = new Error(
      possibleError?.message || "Chrome's media recorder stopped unexpectedly."
    );
    if (!state.stopping && state.startedAt > 0) {
      void finalizeRecording(state, "recorder-error", true);
    }
  });
}

function jpegBlobFromBase64(data: string): Blob {
  if (!data || data.length > 50_000_000) {
    throw new Error("Chrome sent an invalid or oversized page frame.");
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "image/jpeg" });
}

async function drawScreencastFrame(
  sessionId: string,
  data: string
): Promise<
  | { ok: true; width: number; height: number }
  | FailureResult
> {
  const state = activeRecording;
  if (!state || state.payload.sessionId !== sessionId) {
    return { ok: false, error: "No matching page-frame recorder is active." };
  }
  if (state.stopping) {
    return { ok: true, width: state.width, height: state.height };
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(jpegBlobFromBase64(data));
    if (bitmap.width < 1 || bitmap.height < 1) {
      throw new Error("Chrome sent an empty page frame.");
    }

    if (!state.hasScreencastFrame) {
      state.width = bitmap.width;
      state.height = bitmap.height;
      state.canvas.width = state.width;
      state.canvas.height = state.height;
      state.context.imageSmoothingEnabled = true;
      state.context.imageSmoothingQuality = "high";
    }

    state.context.setTransform(1, 0, 0, 1, 0, 0);
    state.context.fillStyle = "#000";
    state.context.fillRect(0, 0, state.width, state.height);
    // Frames from a differently sized tab (after a mid-recording tab switch)
    // are letterboxed; the rect is kept so telemetry can be remapped onto it.
    const rect = containRect(state.width, state.height, bitmap.width, bitmap.height);
    state.contentRect = rect;
    state.context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    state.hasScreencastFrame = true;
    return { ok: true, width: state.width, height: state.height };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  } finally {
    bitmap?.close();
  }
}

async function primeRecording(
  payload: RecorderStartPayload
): Promise<PrimedResult> {
  if (activeRecording) {
    return { ok: false, error: "Another tab recording is already active." };
  }
  if (!payload.sessionId || !payload.streamId) {
    return { ok: false, error: "The recorder did not receive a capture stream." };
  }

  let tabStream: MediaStream | undefined;
  let state: RecordingState | undefined;
  try {
    await deleteRecordingChunks(payload.sessionId);
    void navigator.storage?.persist?.().catch(() => false);
    tabStream = await navigator.mediaDevices.getUserMedia(
      tabAudioConstraints(payload.streamId)
    );
    const audioTracks = tabStream.getAudioTracks();
    if (audioTracks.length === 0) {
      throw new Error("The captured tab did not provide an audio stream.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Chrome could not create the page-frame canvas.");
    const mimeType = selectMimeType();

    let resolveStopped = (): void => undefined;
    const stopPromise = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const recordingState: RecordingState = {
      payload,
      tabStream,
      canvas,
      context,
      hasScreencastFrame: false,
      mimeType: mimeType || "video/webm",
      startedAt: 0,
      width: canvas.width,
      height: canvas.height,
      events: [],
      nextChunk: 0,
      writeChain: Promise.resolve(),
      stopping: false,
      aborted: false,
      stopPromise,
      resolveStopped
    };
    state = recordingState;
    activeRecording = recordingState;

    // The audio track ending (its source tab closed or muted) no longer stops
    // the recording: the capture may have followed the user to another tab.
    // Closing the tab that is currently being recorded is handled by the
    // service worker via tabs.onRemoved.

    await replayTabAudio(recordingState);
    if (audioTracks.every((track) => track.readyState === "ended")) {
      throw new Error("The captured tab was closed before recording started.");
    }
    return {
      ok: true,
      width: recordingState.width,
      height: recordingState.height,
      mimeType: recordingState.mimeType
    };
  } catch (error) {
    if (state) await cleanupMedia(state);
    else tabStream?.getTracks().forEach((track) => track.stop());
    activeRecording = undefined;
    await deleteRecordingChunks(payload.sessionId).catch(() => undefined);
    return { ok: false, error: errorMessage(error) };
  }
}

function beginRecording(
  sessionId: string
): RecorderStartResult | FailureResult {
  const state = activeRecording;
  if (!state || state.payload.sessionId !== sessionId) {
    return { ok: false, error: "The capture stream was not prepared." };
  }
  if (state.startedAt > 0 || state.recorder) {
    return { ok: false, error: "This capture stream has already started." };
  }
  if (!state.hasScreencastFrame) {
    return { ok: false, error: "Chrome did not provide a clean page frame." };
  }
  if (state.tabStream.getAudioTracks().every((track) => track.readyState !== "live")) {
    return { ok: false, error: "The captured tab was closed during countdown." };
  }
  if (state.writeError) return { ok: false, error: state.writeError.message };

  try {
    const canvasStream = state.canvas.captureStream(0);
    const canvasTrack = canvasStream
      .getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!canvasTrack) {
      throw new Error("Chrome could not turn page frames into a video track.");
    }
    const outputStream = new MediaStream([
      canvasTrack,
      ...state.tabStream.getAudioTracks()
    ]);
    const recorder = new MediaRecorder(outputStream, {
      ...(state.mimeType ? { mimeType: state.mimeType } : {}),
      videoBitsPerSecond: 10_000_000
    });
    state.canvasTrack = canvasTrack;
    state.outputStream = outputStream;
    state.recorder = recorder;
    state.mimeType = recorder.mimeType || state.mimeType || "video/webm";
    installRecorderListeners(state, recorder);

    state.startedAt = Date.now();
    recorder.start(1_000);
    canvasTrack.requestFrame();
    state.framePump = window.setInterval(() => {
      if (!state.stopping && canvasTrack.readyState === "live") {
        canvasTrack.requestFrame();
      }
    }, 1_000 / 30);
    return {
      ok: true,
      startedAt: state.startedAt,
      width: state.width,
      height: state.height,
      mimeType: state.mimeType
    };
  } catch (error) {
    if (state.framePump !== undefined) {
      window.clearInterval(state.framePump);
      state.framePump = undefined;
    }
    state.outputStream?.getTracks().forEach((track) => {
      if (!state.tabStream.getTracks().includes(track)) track.stop();
    });
    state.outputStream = undefined;
    state.canvasTrack = undefined;
    state.recorder = undefined;
    state.startedAt = 0;
    return { ok: false, error: errorMessage(error) };
  }
}

function appendEvents(sessionId: string, values: unknown[]): FailureResult | { ok: true } {
  const state = activeRecording;
  if (!state || state.payload.sessionId !== sessionId) {
    return { ok: false, error: "No matching recording is active." };
  }
  if (state.stopping) {
    return { ok: false, error: "The recording is already stopping." };
  }

  for (const value of values.slice(0, 2_000)) {
    const event = normalizeEvent(value);
    if (!event) continue;
    if (event.type === "pointer" || event.type === "click") {
      // Page coordinates are normalized to the tab viewport; project them onto
      // the recorder canvas so the cursor stays aligned after letterboxing.
      const mapped = remapToCanvas(event, state.contentRect);
      state.events.push({ ...event, x: mapped.x, y: mapped.y });
    } else {
      state.events.push(event);
    }
  }
  return { ok: true };
}

function waitForRecorderStop(state: RecordingState): Promise<void> {
  const recorder = state.recorder;
  if (!recorder || recorder.state === "inactive") {
    state.resolveStopped();
    return state.stopPromise;
  }

  try {
    recorder.requestData();
  } catch {
    // Some Chromium versions reject requestData immediately before stop().
  }
  recorder.stop();
  return Promise.race([
    state.stopPromise,
    new Promise<void>((resolve) => window.setTimeout(resolve, 5_000))
  ]);
}

async function cleanupMedia(state: RecordingState): Promise<void> {
  if (state.framePump !== undefined) {
    window.clearInterval(state.framePump);
    state.framePump = undefined;
  }
  const tracks = new Set<MediaStreamTrack>([
    ...state.tabStream.getTracks(),
    ...(state.outputStream?.getTracks() ?? [])
  ]);
  tracks.forEach((track) => track.stop());
  try {
    state.audioSource?.disconnect();
  } catch {
    // The source may already have disconnected when the tab was closed.
  }
  if (state.audioContext && state.audioContext.state !== "closed") {
    await state.audioContext.close().catch(() => undefined);
  }
}

function finalizeRecording(
  state: RecordingState,
  reason: string,
  notifyBackground: boolean
): Promise<RecorderResult> {
  if (state.finalizePromise) return state.finalizePromise;

  state.stopping = true;
  const endedAt = Date.now();
  state.finalizePromise = (async (): Promise<RecorderResult> => {
    let result: RecorderResult;
    try {
      await waitForRecorderStop(state);
      await state.writeChain;
      if (state.writeError) throw state.writeError;
      if (state.aborted) throw new Error("The recording was cancelled.");

      const duration = Math.max(50, endedAt - state.startedAt);
      const events = state.events
        .filter((event) => Number.isFinite(event.t))
        .sort((left, right) => left.t - right.t);
      let zooms: ZoomSegment[] = [];
      try {
        zooms = generateAutoZooms(events, duration);
      } catch {
        // A recording remains editable if automatic zoom analysis cannot run.
      }

      const project = createProject({
        id: state.payload.sessionId,
        title: state.payload.title,
        sourceUrl: state.payload.url,
        createdAt: state.startedAt,
        duration,
        sourceWidth: state.width,
        sourceHeight: state.height,
        mimeType: state.mimeType,
        events,
        zooms
      });
      await putProject(project);
      result = { ok: true, projectId: project.id };
    } catch (error) {
      await deleteRecordingChunks(state.payload.sessionId).catch(() => undefined);
      result = { ok: false, error: errorMessage(error) };
    } finally {
      await cleanupMedia(state);
      if (activeRecording === state) activeRecording = undefined;
    }

    if (notifyBackground) {
      void chrome.runtime
        .sendMessage({
          type: "OFFSCREEN_TERMINATED",
          sessionId: state.payload.sessionId,
          reason,
          result
        })
        .catch(() => undefined);
    }
    return result;
  })();

  return state.finalizePromise;
}

async function stopRecording(sessionId: string): Promise<RecorderResult> {
  const state = activeRecording;
  if (!state || state.payload.sessionId !== sessionId) {
    return { ok: false, error: "The offscreen recorder is not running." };
  }
  return finalizeRecording(state, "requested", false);
}

async function abortRecording(
  sessionId: string
): Promise<{ ok: true } | FailureResult> {
  const state = activeRecording;
  if (!state || state.payload.sessionId !== sessionId) return { ok: true };

  state.aborted = true;
  if (state.finalizePromise) {
    const result = await state.finalizePromise;
    if (result.ok) await deleteProject(result.projectId).catch(() => undefined);
    else await deleteRecordingChunks(sessionId).catch(() => undefined);
    return { ok: true };
  }

  state.stopping = true;
  try {
    await waitForRecorderStop(state);
    await state.writeChain.catch(() => undefined);
  } finally {
    await cleanupMedia(state);
    await deleteRecordingChunks(sessionId).catch(() => undefined);
    if (activeRecording === state) activeRecording = undefined;
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (!isOffscreenMessage(message)) return false;

    if (message.type === "OFFSCREEN_EVENT_BATCH") {
      sendResponse(appendEvents(message.sessionId, message.events));
      return false;
    }

    let operation: Promise<unknown>;
    if (message.type === "OFFSCREEN_PRIME") {
      operation = primeRecording(message);
    } else if (message.type === "OFFSCREEN_SCREENCAST_FRAME") {
      operation = drawScreencastFrame(message.sessionId, message.data);
    } else if (message.type === "OFFSCREEN_START") {
      operation = Promise.resolve(beginRecording(message.sessionId));
    } else if (message.type === "OFFSCREEN_STOP") {
      operation = stopRecording(message.sessionId);
    } else {
      operation = abortRecording(message.sessionId);
    }

    void operation.then(
      (response) => sendResponse(response),
      (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
);
