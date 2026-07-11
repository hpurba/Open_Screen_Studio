import { FFmpeg, FFFSType, type ProgressEvent } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";
import classWorkerURL from "@ffmpeg/ffmpeg/worker?worker&url";
import type { ExportSettings } from "../shared/types";
import { mp4TranscodeArguments } from "./exportFormat";
import { clamp } from "./utils";

type Mp4TranscodeOptions = {
  source: Blob;
  quality: ExportSettings["quality"];
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

const cancelled = () => new DOMException("Export cancelled", "AbortError");

/** Convert the already-composited WebM without sending it off-device. */
export async function transcodeWebMToMp4({
  source,
  quality,
  signal,
  onProgress,
}: Mp4TranscodeOptions) {
  if (signal?.aborted) throw cancelled();

  const ffmpeg = new FFmpeg();
  let loaded = false;
  let mounted = false;
  const progress = ({ progress: value }: ProgressEvent) => {
    if (Number.isFinite(value)) onProgress?.(clamp(value, 0, 1));
  };
  const abort = () => ffmpeg.terminate();
  ffmpeg.on("progress", progress);
  signal?.addEventListener("abort", abort, { once: true });

  try {
    onProgress?.(0);
    await ffmpeg.load(
      { coreURL, wasmURL, classWorkerURL },
      signal ? { signal } : undefined,
    );
    loaded = true;
    if (signal?.aborted) throw cancelled();
    onProgress?.(0.02);

    await ffmpeg.createDir("/input", signal ? { signal } : undefined);
    await ffmpeg.mount(
      FFFSType.WORKERFS,
      { blobs: [{ name: "render.webm", data: source }] },
      "/input",
    );
    mounted = true;
    if (signal?.aborted) throw cancelled();

    const result = await ffmpeg.exec(
      mp4TranscodeArguments(quality),
      -1,
      signal ? { signal } : undefined,
    );
    if (signal?.aborted) throw cancelled();
    if (result !== 0) {
      throw new Error(`The local MP4 encoder stopped with code ${result}.`);
    }

    const output = await ffmpeg.readFile(
      "/output.mp4",
      undefined,
      signal ? { signal } : undefined,
    );
    if (!(output instanceof Uint8Array) || output.byteLength === 0) {
      throw new Error("The local MP4 encoder produced an empty file.");
    }
    onProgress?.(1);
    // Copy into an ArrayBuffer-backed view so it remains a valid BlobPart even
    // if the WASM heap is released immediately afterwards.
    const bytes = output.slice().buffer as ArrayBuffer;
    return new Blob([bytes], { type: "video/mp4" });
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (error instanceof Error && error.message.startsWith("The local MP4")) {
      throw error;
    }
    throw new Error(
      "The local MP4 conversion could not finish. Try WebM for a very long or high-resolution recording.",
      { cause: error },
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    ffmpeg.off("progress", progress);
    if (loaded && !signal?.aborted) {
      if (mounted) await ffmpeg.unmount("/input").catch(() => undefined);
      await ffmpeg.deleteFile("/output.mp4").catch(() => undefined);
    }
    ffmpeg.terminate();
  }
}
