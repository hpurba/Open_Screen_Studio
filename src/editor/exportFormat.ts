import { safeProjectFilename } from "../shared/project";
import type { ExportSettings } from "../shared/types";

export type ExportFormat = ExportSettings["format"];

export function exportFilename(title: string, format: ExportFormat) {
  return `${safeProjectFilename(title)}.${format}`;
}

export function mp4TranscodeArguments(quality: ExportSettings["quality"]) {
  return [
    "-i",
    "/input/render.webm",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    quality === "high" ? "18" : "23",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    quality === "high" ? "192k" : "128k",
    "-movflags",
    "+faststart",
    "-threads",
    "1",
    "/output.mp4",
  ];
}
