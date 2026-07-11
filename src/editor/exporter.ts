import type { Project } from "../shared/types";
import { drawCompositedFrame } from "./compositor";
import { clamp, outputSize } from "./utils";

type ExportOptions = {
  project: Project;
  recording: Blob;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

type CaptureVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

const waitFor = (target: EventTarget, event: string) =>
  new Promise<void>((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The source recording could not be decoded."));
    };
    const cleanup = () => {
      target.removeEventListener(event, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });

const seek = async (video: HTMLVideoElement, seconds: number) => {
  if (Math.abs(video.currentTime - seconds) < 0.01) return;
  const ready = waitFor(video, "seeked");
  video.currentTime = seconds;
  await ready;
};

const mimeTypeForExport = () => {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
};

const safeFilename = (title: string) => {
  const stem = title
    .trim()
    .replace(/[^a-z0-9-_ ]/gi, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return `${stem || "open-screen-recording"}.webm`;
};

export async function exportProject({
  project,
  recording,
  signal,
  onProgress,
}: ExportOptions) {
  if (!recording.size) throw new Error("The recording is empty and cannot be exported.");
  if (typeof MediaRecorder === "undefined") {
    throw new Error("This browser does not support WebM export.");
  }

  const { width, height } = outputSize(project);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas rendering is unavailable.");

  const video = document.createElement("video") as CaptureVideo;
  video.preload = "auto";
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.style.cssText = "position:fixed;width:2px;height:2px;opacity:.001;pointer-events:none";
  const sourceUrl = URL.createObjectURL(recording);
  video.src = sourceUrl;
  document.body.append(video);

  let animation = 0;
  let canvasStream: MediaStream | undefined;
  let sourceStream: MediaStream | undefined;
  let activeRecorder: MediaRecorder | undefined;
  const abort = () => {
    video.pause();
    if (activeRecorder && activeRecorder.state !== "inactive") activeRecorder.stop();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await waitFor(video, "loadedmetadata");
    }
    const start = clamp(project.trimStart, 0, project.duration) / 1000;
    const end = clamp(project.trimEnd, project.trimStart, project.duration) / 1000;
    if (end - start < 0.05) throw new Error("The trim range is too short to export.");
    await seek(video, start);
    drawCompositedFrame(context, video, project, start * 1000);

    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    await video.play();
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

    // Capture audio only after playback has started. A captureStream created
    // while the media element is paused carries that setup delay into the
    // output timestamps and produces a frozen lead-in.
    canvasStream = canvas.captureStream(project.export.fps);
    const capture = video.captureStream ?? video.mozCaptureStream;
    sourceStream = capture?.call(video);
    const tracks = [
      ...canvasStream.getVideoTracks(),
      ...(sourceStream?.getAudioTracks() ?? []),
    ];
    const stream = new MediaStream(tracks);
    const pixelsPerSecond = width * height * project.export.fps;
    const multiplier = project.export.quality === "high" ? 0.155 : 0.095;
    const videoBitsPerSecond = Math.round(
      clamp(pixelsPerSecond * multiplier, 2_500_000, 28_000_000),
    );
    const recorder = new MediaRecorder(stream, {
      mimeType: mimeTypeForExport(),
      videoBitsPerSecond,
      audioBitsPerSecond: 160_000,
    });
    activeRecorder = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const completed = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("The browser stopped the export unexpectedly."));
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    });

    drawCompositedFrame(context, video, project, video.currentTime * 1000);
    recorder.start(1000);

    const render = () => {
      if (signal?.aborted) return;
      const current = video.currentTime;
      drawCompositedFrame(context, video, project, current * 1000);
      onProgress?.(clamp((current - start) / (end - start), 0, 1));
      if (current >= end || video.ended) {
        video.pause();
        onProgress?.(1);
        if (recorder.state !== "inactive") recorder.stop();
        return;
      }
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    const result = await completed;
    signal?.removeEventListener("abort", abort);
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
    if (!result.size) throw new Error("The browser produced an empty export.");
    return { blob: result, filename: safeFilename(project.title) };
  } finally {
    signal?.removeEventListener("abort", abort);
    cancelAnimationFrame(animation);
    video.pause();
    if (activeRecorder?.state !== "inactive") activeRecorder?.stop();
    for (const track of canvasStream?.getTracks() ?? []) track.stop();
    for (const track of sourceStream?.getTracks() ?? []) track.stop();
    video.remove();
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function downloadExport(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    if (typeof chrome !== "undefined" && chrome.downloads?.download) {
      await chrome.downloads.download({ url, filename, saveAs: true });
      // Chrome reads blob URLs asynchronously; keep it alive for a short grace period.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    if (!(typeof chrome !== "undefined" && chrome.downloads?.download)) {
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    }
  }
}
