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
  | { type: "OFFSCREEN_START"; sessionId: string }
  | { type: "OFFSCREEN_EVENT_BATCH"; sessionId: string; events: unknown[] }
  | { type: "OFFSCREEN_STOP"; sessionId: string }
  | { type: "OFFSCREEN_ABORT"; sessionId: string };

type RecordingState = {
  payload: RecorderStartPayload;
  stream: MediaStream;
  recorder: MediaRecorder;
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

function tabConstraints(streamId: string): MediaStreamConstraints {
  const mandatory = {
    chromeMediaSource: "tab",
    chromeMediaSourceId: streamId
  };
  return {
    audio: { mandatory },
    video: { mandatory }
  } as unknown as MediaStreamConstraints;
}

async function replayTabAudio(state: RecordingState): Promise<void> {
  if (state.stream.getAudioTracks().length === 0) return;
  try {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(state.stream);
    source.connect(context.destination);
    if (context.state === "suspended") await context.resume();
    state.audioContext = context;
    state.audioSource = source;
  } catch {
    // Recording remains useful if an enterprise autoplay policy blocks replay.
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

  let stream: MediaStream | undefined;
  let state: RecordingState | undefined;
  try {
    await deleteRecordingChunks(payload.sessionId);
    void navigator.storage?.persist?.().catch(() => false);
    stream = await navigator.mediaDevices.getUserMedia(
      tabConstraints(payload.streamId)
    );

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error("The captured tab did not provide video.");

    const settings = videoTrack.getSettings();
    const width = Math.max(1, Math.round(settings.width ?? 1280));
    const height = Math.max(1, Math.round(settings.height ?? 720));
    const mimeType = selectMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 10_000_000
    });

    let resolveStopped = (): void => undefined;
    const stopPromise = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const recordingState: RecordingState = {
      payload,
      stream,
      recorder,
      mimeType: recorder.mimeType || mimeType || "video/webm",
      startedAt: 0,
      width,
      height,
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

    recorder.addEventListener("dataavailable", (event: BlobEvent) => {
      if (event.data.size === 0) return;
      const chunkIndex = recordingState.nextChunk++;
      recordingState.writeChain = recordingState.writeChain.then(() =>
        putRecordingChunk(payload.sessionId, chunkIndex, event.data)
      );
      void recordingState.writeChain.catch((error: unknown) => {
        recordingState.writeError =
          error instanceof Error ? error : new Error(String(error));
        if (!recordingState.stopping) {
          void finalizeRecording(recordingState, "storage-error", true);
        }
      });
    });
    recorder.addEventListener(
      "stop",
      () => {
        recordingState.resolveStopped();
      },
      { once: true }
    );
    recorder.addEventListener("error", (event: Event) => {
      const possibleError = (event as Event & { error?: DOMException }).error;
      recordingState.writeError = new Error(
        possibleError?.message || "Chrome's media recorder stopped unexpectedly."
      );
      if (!recordingState.stopping && recordingState.startedAt > 0) {
        void finalizeRecording(recordingState, "recorder-error", true);
      }
    });
    videoTrack.addEventListener(
      "ended",
      () => {
        if (!recordingState.stopping && recordingState.startedAt > 0) {
          void finalizeRecording(recordingState, "track-ended", true);
        }
      },
      { once: true }
    );

    await replayTabAudio(recordingState);
    if (videoTrack.readyState === "ended") {
      throw new Error("The captured tab was closed before recording started.");
    }
    return {
      ok: true,
      width,
      height,
      mimeType: recordingState.mimeType
    };
  } catch (error) {
    if (state) await cleanupMedia(state);
    else stream?.getTracks().forEach((track) => track.stop());
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
  if (state.startedAt > 0 || state.recorder.state !== "inactive") {
    return { ok: false, error: "This capture stream has already started." };
  }
  if (state.stream.getVideoTracks()[0]?.readyState !== "live") {
    return { ok: false, error: "The captured tab was closed during countdown." };
  }
  if (state.writeError) return { ok: false, error: state.writeError.message };

  try {
    state.startedAt = Date.now();
    state.recorder.start(1_000);
    return {
      ok: true,
      startedAt: state.startedAt,
      width: state.width,
      height: state.height,
      mimeType: state.mimeType
    };
  } catch (error) {
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
    if (event) state.events.push(event);
  }
  return { ok: true };
}

function waitForRecorderStop(state: RecordingState): Promise<void> {
  if (state.recorder.state === "inactive") {
    state.resolveStopped();
    return state.stopPromise;
  }

  try {
    state.recorder.requestData();
  } catch {
    // Some Chromium versions reject requestData immediately before stop().
  }
  state.recorder.stop();
  return Promise.race([
    state.stopPromise,
    new Promise<void>((resolve) => window.setTimeout(resolve, 5_000))
  ]);
}

async function cleanupMedia(state: RecordingState): Promise<void> {
  state.stream.getTracks().forEach((track) => track.stop());
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

    let operation:
      | Promise<RecorderStartResult | FailureResult>
      | Promise<RecorderResult>
      | Promise<{ ok: true } | FailureResult>;
    if (message.type === "OFFSCREEN_PRIME") {
      operation = primeRecording(message);
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
