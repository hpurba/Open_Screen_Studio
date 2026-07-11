export type Point = { x: number; y: number };

export type CursorKind =
  | "default"
  | "pointer"
  | "text"
  | "grab"
  | "grabbing"
  | "crosshair"
  | "hidden";

export type PointerSample = Point & {
  type: "pointer";
  t: number;
  cursor: CursorKind;
};

export type ClickSample = Point & {
  type: "click";
  t: number;
  button: number;
};

export type ViewportSample = {
  type: "viewport";
  t: number;
  width: number;
  height: number;
  dpr: number;
};

export type PointerVisibilitySample = {
  type: "visibility";
  t: number;
  visible: boolean;
};

export type CaptureEvent =
  | PointerSample
  | ClickSample
  | ViewportSample
  | PointerVisibilitySample;

export type SegmentKind = "auto" | "manual";

export type ZoomSegment = {
  id: string;
  kind: SegmentKind;
  start: number;
  end: number;
  scale: number;
  target: Point;
  follow: boolean;
  instant?: boolean;
};

export type HiddenCursorRange = {
  id: string;
  start: number;
  end: number;
};

export type CursorSettings = {
  visible: boolean;
  size: number;
  smoothing: number;
  hideWhenIdle: boolean;
  idleDelay: number;
  clickRipple: boolean;
};

export type CameraSettings = {
  autoZoom: boolean;
  defaultScale: number;
  transitionMs: number;
  followStrength: number;
  deadZone: number;
};

export type AspectRatio = "source" | "16:9" | "9:16" | "1:1";

export type FrameSettings = {
  aspectRatio: AspectRatio;
  padding: number;
  cornerRadius: number;
  shadow: number;
  background: string;
};

export type ExportSettings = {
  format: "webm" | "mp4";
  width: 1280 | 1920;
  fps: 30 | 60;
  quality: "standard" | "high";
};

export type Project = {
  schemaVersion: 1;
  id: string;
  title: string;
  sourceUrl: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  sourceWidth: number;
  sourceHeight: number;
  mimeType: string;
  events: CaptureEvent[];
  zooms: ZoomSegment[];
  hiddenCursorRanges: HiddenCursorRange[];
  trimStart: number;
  trimEnd: number;
  cursor: CursorSettings;
  camera: CameraSettings;
  frame: FrameSettings;
  export: ExportSettings;
};

export type ProjectSummary = Pick<
  Project,
  "id" | "title" | "sourceUrl" | "createdAt" | "updatedAt" | "duration"
>;

export type ActiveSession = {
  sessionId: string;
  tabId: number;
  title: string;
  url: string;
  status: "countdown" | "recording" | "stopping";
  startedAt?: number;
};

export type RecorderStartPayload = {
  sessionId: string;
  streamId: string;
  title: string;
  url: string;
};

export type RecorderStartResult = {
  ok: true;
  startedAt: number;
  width: number;
  height: number;
  mimeType: string;
};

export type RecorderStopResult = {
  ok: true;
  projectId: string;
};

export type FailureResult = { ok: false; error: string };
