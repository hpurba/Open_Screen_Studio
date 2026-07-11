import { isRecordableUrl } from "./shared/capture";
import type {
  ActiveSession,
  CaptureEvent,
  FailureResult,
  RecorderStartResult,
  RecorderStopResult
} from "./shared/types";

const ACTIVE_SESSION_KEY = "activeRecordingSession";
const CONTENT_SCRIPT_PATH = "assets/content.js";
const OFFSCREEN_PATH = "offscreen.html";
const RECORDING_COLOR = "#ef4444";
const ERROR_COLOR = "#f59e0b";
const DEBUGGER_PROTOCOL_VERSION = "1.3";
const FIRST_SCREENCAST_FRAME_TIMEOUT_MS = 8_000;

type BasicResult = { ok: true } | FailureResult;
type StreamIdResult = { ok: true; streamId: string } | FailureResult;
type PrimedResult =
  | { ok: true; width: number; height: number; mimeType: string }
  | FailureResult;
type PreparedResult = BasicResult & {
  width?: number;
  height?: number;
  dpr?: number;
};
type FinalResult = RecorderStopResult | FailureResult;

type ScreencastFrameResult = BasicResult & {
  width?: number;
  height?: number;
};

type ScreencastFrameParams = {
  data?: unknown;
  sessionId?: unknown;
};

type ActiveScreencast = {
  sessionId: string;
  tabId: number;
  target: chrome.debugger.Debuggee;
  attached: boolean;
  started: boolean;
  halted: boolean;
  stopping: boolean;
  firstFrameSettled: boolean;
  firstFrame: Promise<void>;
  resolveFirstFrame: () => void;
  rejectFirstFrame: (error: Error) => void;
  frameChain: Promise<void>;
  attachPromise?: Promise<void>;
  haltPromise?: Promise<void>;
};

type BackgroundMessage =
  | { type: "CONTENT_READY" }
  | { type: "CONTENT_COUNTDOWN_TICK"; sessionId: string; remaining: number }
  | {
      type: "CONTENT_EVENT_BATCH";
      sessionId: string;
      events: CaptureEvent[];
    }
  | {
      type: "OFFSCREEN_TERMINATED";
      sessionId: string;
      reason: string;
      result: FinalResult;
    };

let creatingOffscreen: Promise<void> | undefined;
let activeSessionCache: ActiveSession | undefined;
let sessionCacheKnown = false;
let activeScreencast: ActiveScreencast | undefined;
const stoppingSessions = new Set<string>();
const completedSessions = new Set<string>();

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/receiving end does not exist/i.test(message)) {
    return "The page recorder is unavailable. Reload the tab and try again.";
  }
  if (/cannot access|chrome:\/\/|web store/i.test(message)) {
    return "Chrome does not allow extensions to record or inspect this page.";
  }
  if (/another debugger|already attached|cannot attach/i.test(message)) {
    return "Close DevTools or any other debugger attached to this tab, then try again.";
  }
  return message;
}

function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  return [
    "CONTENT_READY",
    "CONTENT_COUNTDOWN_TICK",
    "CONTENT_EVENT_BATCH",
    "OFFSCREEN_TERMINATED"
  ].includes(String((value as { type: unknown }).type));
}

function makeSessionId(): string {
  return crypto.randomUUID?.() ??
    `capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function getActiveSession(): Promise<ActiveSession | undefined> {
  const stored = await chrome.storage.session.get(ACTIVE_SESSION_KEY);
  const value = stored[ACTIVE_SESSION_KEY] as ActiveSession | undefined;
  activeSessionCache = value?.sessionId ? value : undefined;
  sessionCacheKnown = true;
  return activeSessionCache;
}

async function setActiveSession(session: ActiveSession): Promise<void> {
  await chrome.storage.session.set({ [ACTIVE_SESSION_KEY]: session });
  activeSessionCache = session;
  sessionCacheKnown = true;
}

async function clearActiveSession(sessionId?: string): Promise<boolean> {
  if (sessionId) {
    const current = await getActiveSession();
    if (!current || current.sessionId !== sessionId) return false;
  }
  await chrome.storage.session.remove(ACTIVE_SESSION_KEY);
  activeSessionCache = undefined;
  sessionCacheKnown = true;
  return true;
}

async function setBadge(text: string, color = RECORDING_COLOR): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setBadgeText({ text })
  ]);
}

async function showError(error: unknown): Promise<void> {
  const message = errorMessage(error);
  await Promise.all([
    setBadge("!", ERROR_COLOR),
    chrome.action.setTitle({ title: `Open Screen Studio: ${message}` })
  ]).catch(() => undefined);

  setTimeout(() => {
    void getActiveSession()
      .then(async (session) => {
        if (session?.status === "recording") {
          await setBadge("REC");
          await chrome.action.setTitle({ title: "Stop recording" });
        } else if (session?.status === "countdown") {
          await setBadge("3");
          await chrome.action.setTitle({ title: "Cancel recording countdown" });
        } else {
          await setBadge("");
          await chrome.action.setTitle({ title: "Start recording this tab" });
        }
      })
      .catch(() => undefined);
  }, 4_000);
}

function requestStreamId(tabId: number): Promise<StreamIdResult> {
  return chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }).then(
    (streamId) =>
      streamId
        ? { ok: true as const, streamId }
        : { ok: false as const, error: "Chrome did not provide a tab stream." },
    (error: unknown) => ({ ok: false as const, error: errorMessage(error) })
  );
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification:
          "Record the selected tab to IndexedDB while the user interacts with it."
      })
      .finally(() => {
        creatingOffscreen = undefined;
      });
  }
  await creatingOffscreen;
}

async function sendToContent<T>(
  tabId: number,
  message: unknown,
  injectIfMissing = false
): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch (firstError) {
    if (!injectIfMissing) throw firstError;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_PATH]
    });
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  }
}

async function sendToOffscreen<T>(message: unknown): Promise<T> {
  await ensureOffscreenDocument();
  return (await chrome.runtime.sendMessage(message)) as T;
}

function sendFrameToOffscreen<T>(message: unknown): Promise<T> {
  // Priming creates the offscreen document before Page.startScreencast. Avoid
  // probing document existence for every JPEG on this frame-rate hot path.
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

function settleFirstScreencastFrame(
  capture: ActiveScreencast,
  error?: Error
): void {
  if (capture.firstFrameSettled) return;
  capture.firstFrameSettled = true;
  if (error) capture.rejectFirstFrame(error);
  else capture.resolveFirstFrame();
}

async function acknowledgeScreencastFrame(
  target: chrome.debugger.Debuggee,
  frameSessionId: number
): Promise<void> {
  await chrome.debugger
    .sendCommand(target, "Page.screencastFrameAck", {
      sessionId: frameSessionId
    })
    .then(() => undefined)
    .catch(() => undefined);
}

async function forwardScreencastFrame(
  capture: ActiveScreencast,
  source: chrome.debugger.DebuggerSession,
  params: ScreencastFrameParams
): Promise<void> {
  const frameSessionId = Number(params.sessionId);
  const data = typeof params.data === "string" ? params.data : "";

  try {
    if (!Number.isFinite(frameSessionId) || !data) {
      throw new Error("Chrome sent an invalid page frame.");
    }
    if (capture.stopping || activeScreencast !== capture) return;
    const result = await sendFrameToOffscreen<ScreencastFrameResult>({
      type: "OFFSCREEN_SCREENCAST_FRAME",
      sessionId: capture.sessionId,
      data
    });
    if (!result?.ok) {
      throw new Error(result?.error || "The page frame could not be decoded.");
    }
    settleFirstScreencastFrame(capture);
  } finally {
    if (Number.isFinite(frameSessionId)) {
      await acknowledgeScreencastFrame(source, frameSessionId);
    }
  }
}

async function attachPageCapture(session: ActiveSession): Promise<void> {
  if (activeScreencast) {
    throw new Error("Another cursor-free page capture is already active.");
  }

  let resolveFirstFrame = (): void => undefined;
  let rejectFirstFrame = (_error: Error): void => undefined;
  const firstFrame = new Promise<void>((resolve, reject) => {
    resolveFirstFrame = resolve;
    rejectFirstFrame = reject;
  });
  // A cancellation can reject the deferred frame before the start path reaches
  // its await. Keep that expected rejection from becoming an unhandled promise.
  void firstFrame.catch(() => undefined);

  const capture: ActiveScreencast = {
    sessionId: session.sessionId,
    tabId: session.tabId,
    target: { tabId: session.tabId },
    attached: false,
    started: false,
    halted: false,
    stopping: false,
    firstFrameSettled: false,
    firstFrame,
    resolveFirstFrame,
    rejectFirstFrame,
    frameChain: Promise.resolve()
  };
  activeScreencast = capture;

  const attachPromise = (async () => {
    await chrome.debugger.attach(capture.target, DEBUGGER_PROTOCOL_VERSION);
    capture.attached = true;
    if (activeScreencast !== capture || capture.stopping) {
      await chrome.debugger.detach(capture.target).catch(() => undefined);
      capture.attached = false;
      throw new Error("The cursor-free page capture was cancelled.");
    }
    await chrome.debugger.sendCommand(capture.target, "Page.enable");
    if (activeScreencast !== capture || capture.stopping) {
      await chrome.debugger.detach(capture.target).catch(() => undefined);
      capture.attached = false;
      throw new Error("The cursor-free page capture was cancelled.");
    }
  })();
  capture.attachPromise = attachPromise;

  try {
    await attachPromise;
  } catch (error) {
    await detachPageCapture(session.sessionId, session.tabId);
    throw new Error(errorMessage(error));
  }
}

const SCREENCAST_PARAMS = {
  format: "jpeg",
  quality: 90,
  everyNthFrame: 1
} as const;

async function startPageScreencast(
  sessionId: string,
  waitForFirstFrame = true
): Promise<void> {
  const capture = activeScreencast;
  if (!capture || capture.sessionId !== sessionId || !capture.attached) {
    throw new Error("The cursor-free page capture was not prepared.");
  }
  if (capture.started) {
    throw new Error("The cursor-free page capture has already started.");
  }

  capture.started = true;
  try {
    await chrome.debugger.sendCommand(
      capture.target,
      "Page.startScreencast",
      { ...SCREENCAST_PARAMS }
    );
    // Resumed captures draw over the previous frame whenever the tab next
    // paints, so only a fresh recording must block on its first clean frame.
    if (!waitForFirstFrame) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Chrome did not provide the first page frame.")),
        FIRST_SCREENCAST_FRAME_TIMEOUT_MS
      );
    });
    try {
      await Promise.race([capture.firstFrame, timeout]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  } catch (error) {
    await detachPageCapture(sessionId, capture.tabId);
    throw new Error(errorMessage(error));
  }
}

/**
 * An in-place navigation (refresh or same-tab link) keeps the debugger
 * attached but can stall the frame stream; stop/start kicks it back on.
 */
async function restartScreencast(capture: ActiveScreencast): Promise<void> {
  if (activeScreencast !== capture || capture.stopping || !capture.attached) {
    return;
  }
  await chrome.debugger
    .sendCommand(capture.target, "Page.stopScreencast")
    .catch(() => undefined);
  if (activeScreencast !== capture || capture.stopping || !capture.attached) {
    return;
  }
  await chrome.debugger
    .sendCommand(capture.target, "Page.startScreencast", { ...SCREENCAST_PARAMS })
    .catch(() => undefined);
}

async function haltPageScreencast(sessionId: string): Promise<void> {
  const capture = activeScreencast;
  if (!capture || capture.sessionId !== sessionId) return;
  if (capture.haltPromise) return capture.haltPromise;
  capture.stopping = true;

  capture.haltPromise = (async () => {
    if (capture.started && !capture.halted && capture.attached) {
      capture.halted = true;
      await chrome.debugger
        .sendCommand(capture.target, "Page.stopScreencast")
        .then(() => undefined)
        .catch(() => undefined);
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(resolve, 3_000);
    });
    try {
      await Promise.race([capture.frameChain.catch(() => undefined), timeout]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  })();
  return capture.haltPromise;
}

async function detachPageCapture(
  sessionId: string,
  fallbackTabId?: number
): Promise<void> {
  const capture = activeScreencast;
  if (capture?.sessionId === sessionId) {
    capture.stopping = true;
    await capture.attachPromise?.catch(() => undefined);
    await haltPageScreencast(sessionId);
    settleFirstScreencastFrame(
      capture,
      new Error("The cursor-free page capture was cancelled.")
    );
    if (activeScreencast === capture) activeScreencast = undefined;
    if (capture.attached) {
      await chrome.debugger.detach(capture.target).catch(() => undefined);
    }
    return;
  }

  if (fallbackTabId !== undefined) {
    await chrome.debugger
      .detach({ tabId: fallbackTabId })
      .catch(() => undefined);
  }
}

async function startSession(
  tab: chrome.tabs.Tab,
  streamIdPromise: Promise<StreamIdResult>
): Promise<void> {
  if (tab.id === undefined || !isRecordableUrl(tab.url)) {
    await showError(
      "Open a normal http:// or https:// website before starting a recording."
    );
    return;
  }

  const session: ActiveSession = {
    sessionId: makeSessionId(),
    tabId: tab.id,
    title: tab.title?.trim() || "Untitled recording",
    url: tab.url,
    status: "countdown"
  };

  try {
    await setActiveSession(session);
    await Promise.all([
      setBadge("3"),
      chrome.action.setTitle({ title: "Cancel recording countdown" })
    ]);

    const [streamResult] = await Promise.all([
      streamIdPromise,
      ensureOffscreenDocument()
    ]);
    if (!streamResult.ok) throw new Error(streamResult.error);

    let current = await getActiveSession();
    if (!current || current.sessionId !== session.sessionId) return;

    // Consume the short-lived tab stream id immediately. Its audio track is
    // retained while cursor-free page frames provide the recorded video.
    const primed = await sendToOffscreen<PrimedResult>({
      type: "OFFSCREEN_PRIME",
      sessionId: session.sessionId,
      streamId: streamResult.streamId,
      title: session.title,
      url: session.url
    });
    if (!primed?.ok) {
      throw new Error(primed?.error || "The tab capture stream could not open.");
    }

    current = await getActiveSession();
    if (!current || current.sessionId !== session.sessionId) {
      await sendToOffscreen<BasicResult>({
        type: "OFFSCREEN_ABORT",
        sessionId: session.sessionId
      }).catch(() => undefined);
      return;
    }

    // Attach before countdown so Chrome's debugger banner and any resulting
    // viewport resize are already stable when the recording begins.
    await attachPageCapture(session);

    const prepared = await sendToContent<PreparedResult>(
      session.tabId,
      {
        type: "CONTENT_PREPARE",
        sessionId: session.sessionId,
        countdownSeconds: 3
      },
      true
    );
    if (!prepared?.ok) {
      throw new Error(prepared?.error || "The page could not prepare for capture.");
    }

    current = await getActiveSession();
    if (
      !current ||
      current.sessionId !== session.sessionId ||
      current.status !== "countdown"
    ) {
      await Promise.allSettled([
        sendToContent<BasicResult>(session.tabId, {
          type: "CONTENT_CANCEL",
          sessionId: session.sessionId
        }),
        sendToOffscreen<BasicResult>({
          type: "OFFSCREEN_ABORT",
          sessionId: session.sessionId
        }),
        detachPageCapture(session.sessionId, session.tabId)
      ]);
      return;
    }

    // The countdown host has been removed. Wait until its first clean page
    // frame is decoded into the recorder canvas before starting MediaRecorder.
    await startPageScreencast(session.sessionId);

    current = await getActiveSession();
    if (
      !current ||
      current.sessionId !== session.sessionId ||
      current.status !== "countdown"
    ) {
      await detachPageCapture(session.sessionId, session.tabId);
      await sendToOffscreen<BasicResult>({
        type: "OFFSCREEN_ABORT",
        sessionId: session.sessionId
      }).catch(() => undefined);
      return;
    }

    const started = await sendToOffscreen<RecorderStartResult | FailureResult>({
      type: "OFFSCREEN_START",
      sessionId: session.sessionId
    });
    if (!started?.ok) {
      throw new Error(started?.error || "The tab recorder could not start.");
    }

    current = await getActiveSession();
    if (
      !current ||
      current.sessionId !== session.sessionId ||
      current.status !== "countdown"
    ) {
      await Promise.allSettled([
        sendToOffscreen<BasicResult>({
          type: "OFFSCREEN_ABORT",
          sessionId: session.sessionId
        }),
        detachPageCapture(session.sessionId, session.tabId)
      ]);
      return;
    }

    const recordingSession: ActiveSession = {
      ...session,
      status: "recording",
      startedAt: started.startedAt
    };
    await setActiveSession(recordingSession);

    const contentStarted = await sendToContent<BasicResult>(session.tabId, {
      type: "CONTENT_START",
      sessionId: session.sessionId,
      startedAt: started.startedAt
    });
    if (!contentStarted?.ok) {
      throw new Error(
        contentStarted?.error || "The page telemetry recorder could not start."
      );
    }

    await Promise.all([
      setBadge("REC"),
      chrome.action.setTitle({ title: "Stop recording" })
    ]);
  } catch (error) {
    await Promise.allSettled([
      sendToContent<BasicResult>(session.tabId, {
        type: "CONTENT_CANCEL",
        sessionId: session.sessionId
      }),
      sendToOffscreen<BasicResult>({
        type: "OFFSCREEN_ABORT",
        sessionId: session.sessionId
      }),
      detachPageCapture(session.sessionId, session.tabId)
    ]);
    await clearActiveSession(session.sessionId);
    if (!completedSessions.has(session.sessionId)) await showError(error);
  }
}

async function cancelCountdown(session: ActiveSession): Promise<void> {
  if (completedSessions.has(session.sessionId)) return;
  completedSessions.add(session.sessionId);
  await Promise.allSettled([
    sendToContent<BasicResult>(session.tabId, {
      type: "CONTENT_CANCEL",
      sessionId: session.sessionId
    }),
    sendToOffscreen<BasicResult>({
      type: "OFFSCREEN_ABORT",
      sessionId: session.sessionId
    }),
    detachPageCapture(session.sessionId, session.tabId)
  ]);
  await clearActiveSession(session.sessionId);
  await Promise.all([
    setBadge(""),
    chrome.action.setTitle({ title: "Start recording this tab" })
  ]);
}

async function completeSession(
  session: ActiveSession,
  result: FinalResult
): Promise<void> {
  if (completedSessions.has(session.sessionId)) return;
  completedSessions.add(session.sessionId);

  await detachPageCapture(session.sessionId, session.tabId);
  await sendToContent<BasicResult>(session.tabId, {
    type: "CONTENT_STOP",
    sessionId: session.sessionId
  }).catch(() => undefined);
  await clearActiveSession(session.sessionId);

  if (result.ok) {
    await Promise.all([
      setBadge(""),
      chrome.action.setTitle({ title: "Start recording this tab" })
    ]);
    await chrome.tabs.create({
      url: chrome.runtime.getURL(
        `editor.html#/project/${encodeURIComponent(result.projectId)}`
      )
    });
  } else {
    await showError(result.error);
  }
}

async function stopSession(session: ActiveSession): Promise<void> {
  if (stoppingSessions.has(session.sessionId)) return;
  stoppingSessions.add(session.sessionId);
  try {
    const current = await getActiveSession();
    if (!current || current.sessionId !== session.sessionId) return;
    await setActiveSession({ ...current, status: "stopping" });
    await setBadge("…");

    await sendToContent<BasicResult>(session.tabId, {
      type: "CONTENT_FLUSH",
      sessionId: session.sessionId
    }).catch(() => undefined);

    await haltPageScreencast(session.sessionId);
    const result = await sendToOffscreen<FinalResult>({
        type: "OFFSCREEN_STOP",
        sessionId: session.sessionId
      })
      .catch(
        (error: unknown): FailureResult => ({
          ok: false,
          error: errorMessage(error)
        })
      )
      .finally(() => detachPageCapture(session.sessionId, session.tabId));
    await completeSession(session, result);
  } finally {
    stoppingSessions.delete(session.sessionId);
  }
}

async function toggleRecording(
  tab: chrome.tabs.Tab,
  streamIdPromise: Promise<StreamIdResult>
): Promise<void> {
  const active = await getActiveSession();
  if (active) {
    // Consume errors from the eagerly requested id; an id is intentionally unused
    // when the click is the stop half of the toggle.
    void streamIdPromise.then(() => undefined);
    if (active.status === "countdown") {
      await cancelCountdown(active);
    } else {
      await stopSession(active);
    }
    return;
  }
  await startSession(tab, streamIdPromise);
}

async function handleContentReady(
  sender: chrome.runtime.MessageSender
): Promise<Record<string, unknown>> {
  const active = await getActiveSession();
  if (
    active?.status === "recording" &&
    active.startedAt !== undefined &&
    sender.tab?.id === active.tabId
  ) {
    return {
      active: true,
      sessionId: active.sessionId,
      startedAt: active.startedAt
    };
  }
  return { active: false };
}

async function handleCountdownTick(
  message: Extract<BackgroundMessage, { type: "CONTENT_COUNTDOWN_TICK" }>,
  sender: chrome.runtime.MessageSender
): Promise<BasicResult> {
  const active = await getActiveSession();
  if (
    active?.sessionId !== message.sessionId ||
    active.status !== "countdown" ||
    sender.tab?.id !== active.tabId
  ) {
    return { ok: false, error: "This countdown is no longer active." };
  }
  await setBadge(String(Math.max(1, Math.min(3, Math.round(message.remaining)))));
  return { ok: true };
}

async function forwardEventBatch(
  message: Extract<BackgroundMessage, { type: "CONTENT_EVENT_BATCH" }>,
  sender: chrome.runtime.MessageSender
): Promise<BasicResult> {
  const active = await getActiveSession();
  if (
    active?.sessionId !== message.sessionId ||
    (active.status !== "recording" && active.status !== "stopping") ||
    sender.tab?.id !== active.tabId
  ) {
    return { ok: false, error: "This page is not the active recording tab." };
  }

  try {
    return await sendToOffscreen<BasicResult>({
      type: "OFFSCREEN_EVENT_BATCH",
      sessionId: message.sessionId,
      events: Array.isArray(message.events) ? message.events : []
    });
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

async function handleTerminated(
  message: Extract<BackgroundMessage, { type: "OFFSCREEN_TERMINATED" }>
): Promise<BasicResult> {
  const active = await getActiveSession();
  if (!active || active.sessionId !== message.sessionId) return { ok: true };
  await completeSession(active, message.result);
  return { ok: true };
}

async function discardStaleSession(): Promise<void> {
  const active = await getActiveSession();
  if (active) {
    await Promise.allSettled([
      sendToContent<BasicResult>(
        active.tabId,
        { type: "CONTENT_CANCEL", sessionId: active.sessionId },
        true
      ),
      sendToOffscreen<BasicResult>({
        type: "OFFSCREEN_ABORT",
        sessionId: active.sessionId
      }),
      detachPageCapture(active.sessionId, active.tabId)
    ]);
  }
  await clearActiveSession();
}

chrome.action.onClicked.addListener((tab) => {
  if (sessionCacheKnown && activeSessionCache) {
    const active = activeSessionCache;
    void (active.status === "countdown"
      ? cancelCountdown(active)
      : stopSession(active)
    ).catch(showError);
    return;
  }

  // getMediaStreamId is deliberately invoked synchronously in the user gesture.
  const streamIdPromise =
    tab.id !== undefined && isRecordableUrl(tab.url)
      ? requestStreamId(tab.id)
      : Promise.resolve<StreamIdResult>({
          ok: false,
          error: "Open a normal website before starting a recording."
        });
  void toggleRecording(tab, streamIdPromise).catch(showError);
});

chrome.debugger.onEvent.addListener((source, method, rawParams) => {
  if (method === "Page.frameNavigated") {
    const frame = (rawParams as { frame?: { parentId?: string } } | undefined)
      ?.frame;
    const navigatedCapture = activeScreencast;
    if (
      !frame?.parentId &&
      navigatedCapture &&
      source.tabId === navigatedCapture.tabId &&
      navigatedCapture.started &&
      !navigatedCapture.stopping
    ) {
      void restartScreencast(navigatedCapture);
    }
    return;
  }
  if (method !== "Page.screencastFrame") return;
  const params = (rawParams ?? {}) as ScreencastFrameParams;
  const capture = activeScreencast;

  if (!capture || source.tabId !== capture.tabId) {
    const frameSessionId = Number(params.sessionId);
    if (Number.isFinite(frameSessionId)) {
      void acknowledgeScreencastFrame(source, frameSessionId);
    }
    return;
  }

  const nextFrame = capture.frameChain.then(() =>
    forwardScreencastFrame(capture, source, params)
  );
  capture.frameChain = nextFrame.catch(() => undefined);
  void nextFrame.catch((error: unknown) => {
    const failure = new Error(errorMessage(error));
    const hadCleanFrame = capture.firstFrameSettled;
    settleFirstScreencastFrame(capture, failure);
    if (!hadCleanFrame || capture.stopping) return;
    capture.stopping = true;

    void getActiveSession()
      .then(async (active) => {
        if (!active || active.sessionId !== capture.sessionId) return;
        if (active.status === "countdown") await cancelCountdown(active);
        else await stopSession(active);
        await showError(failure);
      })
      .catch(showError);
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const capture = activeScreencast;
  if (!capture || source.tabId !== capture.tabId) return;

  const expected = capture.stopping;
  capture.attached = false;
  if (activeScreencast === capture) activeScreencast = undefined;
  settleFirstScreencastFrame(
    capture,
    new Error(`Chrome ended the page capture (${reason}).`)
  );
  if (expected) return;
  const targetClosed = reason === "target_closed";

  void getActiveSession()
    .then(async (active) => {
      if (!active || active.sessionId !== capture.sessionId) return;
      if (active.status === "countdown") {
        await cancelCountdown(active);
        return;
      }
      // A hard cross-process navigation can drop the attachment while the
      // tab lives on. Re-attach and keep recording instead of giving up.
      if (active.status === "recording" && !targetClosed) {
        const tab = await chrome.tabs.get(active.tabId).catch(() => undefined);
        if (tab && isRecordableUrl(tab.url)) {
          try {
            await attachPageCapture(active);
            await startPageScreencast(active.sessionId, false);
            return;
          } catch {
            // Fall through to the stop path below.
          }
        }
      }
      await stopSession(active);
      if (!targetClosed) {
        await showError(
          "Chrome ended the cursor-free page capture. Close DevTools and retry."
        );
      }
    })
    .catch(showError);
});

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (!isBackgroundMessage(message)) return false;

    let operation: Promise<unknown>;
    if (message.type === "CONTENT_READY") {
      operation = handleContentReady(sender);
    } else if (message.type === "CONTENT_COUNTDOWN_TICK") {
      operation = handleCountdownTick(message, sender);
    } else if (message.type === "CONTENT_EVENT_BATCH") {
      operation = forwardEventBatch(message, sender);
    } else {
      operation = handleTerminated(message);
    }

    void operation.then(
      (response) => sendResponse(response),
      (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) })
    );
    return true;
  }
);

let tabFollowChain: Promise<void> = Promise.resolve();

function queueTabFollow(tabId: number): void {
  tabFollowChain = tabFollowChain
    .then(() => followActiveTab(tabId))
    .catch(() => undefined);
}

/**
 * Move a live recording to the tab the user just switched to: telemetry off
 * in the outgoing tab, screencast re-attached to the incoming one, and the
 * incoming tab's content script joined to the running session.
 */
async function followActiveTab(tabId: number): Promise<void> {
  const active = await getActiveSession();
  if (
    !active ||
    active.status !== "recording" ||
    active.startedAt === undefined ||
    active.tabId === tabId
  ) {
    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  // Privileged pages cannot be captured. Keep the current target so the
  // recording resumes the moment the user returns to a recordable tab.
  if (!tab || !isRecordableUrl(tab.url)) return;

  const previous = active;

  // Flush and stop telemetry while the outgoing tab is still the session
  // tab so its final event batches are accepted.
  await sendToContent<BasicResult>(previous.tabId, {
    type: "CONTENT_STOP",
    sessionId: previous.sessionId
  }).catch(() => undefined);

  await detachPageCapture(previous.sessionId, previous.tabId);

  const moved: ActiveSession = { ...previous, tabId, url: tab.url };
  try {
    await attachPageCapture(moved);
    await startPageScreencast(moved.sessionId, false);
  } catch (error) {
    await recoverPreviousTarget(previous, error);
    return;
  }

  const current = await getActiveSession();
  if (
    !current ||
    current.sessionId !== moved.sessionId ||
    current.status !== "recording"
  ) {
    await detachPageCapture(moved.sessionId, tabId);
    return;
  }

  await setActiveSession(moved);
  await sendToContent<BasicResult>(
    tabId,
    {
      type: "CONTENT_RESUME",
      sessionId: moved.sessionId,
      startedAt: moved.startedAt
    },
    true
  ).catch(() => undefined);
}

async function recoverPreviousTarget(
  previous: ActiveSession,
  error: unknown
): Promise<void> {
  try {
    await attachPageCapture(previous);
    await startPageScreencast(previous.sessionId, false);
    await sendToContent<BasicResult>(
      previous.tabId,
      {
        type: "CONTENT_RESUME",
        sessionId: previous.sessionId,
        startedAt: previous.startedAt
      },
      true
    ).catch(() => undefined);
  } catch {
    const current = await getActiveSession();
    if (current?.sessionId === previous.sessionId) {
      await stopSession(current);
      await showError(error);
    }
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  queueTabFollow(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs
    .query({ active: true, windowId })
    .then((tabs) => {
      const nextTabId = tabs[0]?.id;
      if (nextTabId !== undefined) queueTabFollow(nextTabId);
    })
    .catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void getActiveSession().then((active) => {
    if (!active || active.tabId !== tabId) return;
    if (active.status === "countdown") void cancelCountdown(active);
    else void stopSession(active);
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await discardStaleSession();
    await setBadge("");
    await chrome.action.setTitle({ title: "Start recording this tab" });
    if (details.reason === "install") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
    }
  })().catch(showError);
});

chrome.runtime.onStartup.addListener(() => {
  void discardStaleSession()
    .then(() => setBadge(""))
    .catch(showError);
});

void getActiveSession()
  .then(async (active) => {
    if (active?.status === "recording") {
      await setBadge("REC");
      await chrome.action.setTitle({ title: "Stop recording" });
    } else if (active?.status === "countdown") {
      await setBadge("3");
      await chrome.action.setTitle({ title: "Cancel recording countdown" });
    }
  })
  .catch(() => undefined);
