import type {
  CameraSettings,
  CaptureEvent,
  CursorSettings,
  ExportSettings,
  FrameSettings,
  Project,
  ZoomSegment,
} from "./types";

export const DEFAULT_CURSOR_SETTINGS: CursorSettings = {
  visible: true,
  size: 1.15,
  smoothing: 0.72,
  hideWhenIdle: true,
  idleDelay: 1100,
  clickRipple: true,
};

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  autoZoom: true,
  defaultScale: 1,
  transitionMs: 380,
  followStrength: 0.42,
  deadZone: 0.1,
};

export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
  aspectRatio: "source",
  padding: 56,
  cornerRadius: 18,
  shadow: 0.55,
  background: "aurora",
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  width: 1920,
  fps: 60,
  quality: "high",
};

type NewProject = {
  id: string;
  title: string;
  sourceUrl: string;
  createdAt?: number;
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  mimeType: string;
  events: CaptureEvent[];
  zooms?: ZoomSegment[];
};

export function createProject(input: NewProject): Project {
  const createdAt = input.createdAt ?? Date.now();
  return {
    schemaVersion: 1,
    id: input.id,
    title: input.title || "Untitled recording",
    sourceUrl: input.sourceUrl,
    createdAt,
    updatedAt: createdAt,
    duration: Math.max(0, input.duration),
    sourceWidth: Math.max(1, Math.round(input.sourceWidth)),
    sourceHeight: Math.max(1, Math.round(input.sourceHeight)),
    mimeType: input.mimeType,
    events: [...input.events].sort((a, b) => a.t - b.t),
    zooms: [...(input.zooms ?? [])].sort((a, b) => a.start - b.start),
    hiddenCursorRanges: [],
    trimStart: 0,
    trimEnd: Math.max(0, input.duration),
    cursor: { ...DEFAULT_CURSOR_SETTINGS },
    camera: { ...DEFAULT_CAMERA_SETTINGS },
    frame: { ...DEFAULT_FRAME_SETTINGS },
    export: { ...DEFAULT_EXPORT_SETTINGS },
  };
}

/** Fills fields introduced by non-destructive editor updates without touching source data. */
export function normalizeProject(value: Project): Project {
  const duration = Math.max(0, Number(value.duration) || 0);
  const trimStart = Math.min(duration, Math.max(0, Number(value.trimStart) || 0));
  const trimEnd = Math.min(
    duration,
    Math.max(trimStart, Number(value.trimEnd) || duration),
  );

  return {
    ...value,
    schemaVersion: 1,
    duration,
    trimStart,
    trimEnd,
    events: [...(value.events ?? [])].sort((a, b) => a.t - b.t),
    zooms: [...(value.zooms ?? [])].sort((a, b) => a.start - b.start),
    hiddenCursorRanges: [...(value.hiddenCursorRanges ?? [])].sort(
      (a, b) => a.start - b.start,
    ),
    cursor: { ...DEFAULT_CURSOR_SETTINGS, ...value.cursor },
    camera: { ...DEFAULT_CAMERA_SETTINGS, ...value.camera },
    frame: { ...DEFAULT_FRAME_SETTINGS, ...value.frame },
    export: { ...DEFAULT_EXPORT_SETTINGS, ...value.export },
  };
}

export function safeProjectFilename(title: string) {
  const normalized = title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (normalized || "open-screen-recording").slice(0, 80);
}
