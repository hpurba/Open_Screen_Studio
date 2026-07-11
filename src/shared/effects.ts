import type {
  CameraSettings,
  CaptureEvent,
  ClickSample,
  CursorKind,
  CursorSettings,
  HiddenCursorRange,
  Point,
  PointerSample,
  PointerVisibilitySample,
  ZoomSegment,
} from "./types";

const EPSILON = 1e-9;
const MAX_CURSOR_SMOOTHING_MS = 240;
const DEFAULT_CURSOR_FADE_MS = 120;
const DEFAULT_IDLE_FADE_MS = 220;
const AUTO_ZOOM_LEAD_MS = 280;
const AUTO_ZOOM_TAIL_MS = 1_450;
const AUTO_ZOOM_MERGE_GAP_MS = 420;
const MAX_CAMERA_SCALE = 32;

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  autoZoom: true,
  defaultScale: 1,
  transitionMs: 420,
  followStrength: 0.8,
  deadZone: 0.22,
};

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ZoomState = {
  scale: number;
  target: Point;
  follow: boolean;
  progress: number;
  segmentId: string | null;
};

export type CameraState = ZoomState & {
  center: Point;
  source: NormalizedRect;
};

export type CursorState = {
  position: Point;
  kind: CursorKind;
  opacity: number;
  visible: boolean;
};

/** Clamp a value while also making malformed numeric input deterministic. */
export function clamp(value: number, minimum = 0, maximum = 1): number {
  let min = Number.isFinite(minimum) ? minimum : 0;
  let max = Number.isFinite(maximum) ? maximum : 1;

  if (min > max) {
    [min, max] = [max, min];
  }

  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

/**
 * Cubic Hermite easing. It supports both smoothstep(value) and the GLSL-style
 * smoothstep(edge0, edge1, value) forms.
 */
export function smoothstep(value: number): number;
export function smoothstep(edge0: number, edge1: number, value: number): number;
export function smoothstep(
  edgeOrValue: number,
  edge1?: number,
  value?: number,
): number {
  const hasEdges = edge1 !== undefined && value !== undefined;
  const start = hasEdges && Number.isFinite(edgeOrValue) ? edgeOrValue : 0;
  const end = hasEdges && Number.isFinite(edge1) ? edge1 : 1;
  const input = hasEdges ? value : edgeOrValue;

  if (!Number.isFinite(input)) {
    return 0;
  }

  if (Math.abs(end - start) <= EPSILON) {
    return input < start ? 0 : 1;
  }

  const normalized = clamp((input - start) / (end - start));
  return normalized * normalized * (3 - 2 * normalized);
}

export function lerp(start: number, end: number, amount: number): number {
  const safeStart = Number.isFinite(start) ? start : 0;
  const safeEnd = Number.isFinite(end) ? end : safeStart;
  return safeStart + (safeEnd - safeStart) * clamp(amount);
}

function normalizeTime(time: number): number {
  return Number.isFinite(time) ? Math.max(0, time) : 0;
}

function normalizedPoint(point: Point | null | undefined, fallback = 0.5): Point {
  return {
    x: clamp(point?.x ?? fallback),
    y: clamp(point?.y ?? fallback),
  };
}

function pointLerp(start: Point, end: Point, amount: number): Point {
  return {
    x: clamp(lerp(start.x, end.x, amount)),
    y: clamp(lerp(start.y, end.y, amount)),
  };
}

function isFinitePositionEvent(
  event: CaptureEvent,
): event is PointerSample | ClickSample {
  return (
    (event.type === "pointer" || event.type === "click") &&
    Number.isFinite(event.t) &&
    Number.isFinite(event.x) &&
    Number.isFinite(event.y)
  );
}

type PositionSample = Point & {
  t: number;
  click: boolean;
  order: number;
};

function positionSamples(events: CaptureEvent[]): PositionSample[] {
  const sorted = events
    .map((event, order) => ({ event, order }))
    .filter(
      (entry): entry is {
        event: PointerSample | ClickSample;
        order: number;
      } => isFinitePositionEvent(entry.event),
    )
    .map(({ event, order }) => ({
      ...normalizedPoint(event),
      t: Math.max(0, event.t),
      click: event.type === "click",
      order,
    }))
    .sort((left, right) => {
      if (left.t !== right.t) return left.t - right.t;
      if (left.click !== right.click) return left.click ? 1 : -1;
      return left.order - right.order;
    });

  // A click is deliberately sorted last and therefore becomes the exact sample
  // when pointer and click telemetry share a timestamp.
  const collapsed: PositionSample[] = [];
  for (const sample of sorted) {
    const previous = collapsed.at(-1);
    if (previous && Math.abs(previous.t - sample.t) <= EPSILON) {
      collapsed[collapsed.length - 1] = sample;
    } else {
      collapsed.push(sample);
    }
  }

  return collapsed;
}

function interpolateSamples(samples: PositionSample[], time: number): Point {
  if (samples.length === 0) return { x: 0.5, y: 0.5 };

  const t = normalizeTime(time);
  if (t <= samples[0].t) return normalizedPoint(samples[0]);

  const last = samples[samples.length - 1];
  if (t >= last.t) return normalizedPoint(last);

  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].t <= t) low = middle;
    else high = middle;
  }

  const start = samples[low];
  const end = samples[high];
  const span = end.t - start.t;
  if (span <= EPSILON) return normalizedPoint(end);
  return pointLerp(start, end, (t - start.t) / span);
}

function smoothingWindowMs(smoothing: number): number {
  return clamp(smoothing) * MAX_CURSOR_SMOOTHING_MS;
}

function centeredSmoothedPoint(
  samples: PositionSample[],
  time: number,
  windowMs: number,
): Point {
  if (samples.length < 2 || windowMs <= EPSILON) {
    return interpolateSamples(samples, time);
  }

  // Symmetric sampling is important: a causal average permanently trails the
  // raw cursor, while this kernel preserves constant-velocity motion.
  const offsets = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
  let x = 0;
  let y = 0;
  let totalWeight = 0;

  for (const offset of offsets) {
    const weight = 1 - Math.abs(offset) * 0.72;
    const point = interpolateSamples(samples, time + offset * windowMs);
    x += point.x * weight;
    y += point.y * weight;
    totalWeight += weight;
  }

  return normalizedPoint({ x: x / totalWeight, y: y / totalWeight });
}

type CorrectionAnchor = PositionSample & { correction: Point };

function correctionAnchors(
  samples: PositionSample[],
  windowMs: number,
): CorrectionAnchor[] {
  if (samples.length === 0) return [];

  const anchors = samples.filter(
    (sample, index) =>
      index === 0 || index === samples.length - 1 || sample.click,
  );

  return anchors.map((anchor) => {
    const smoothed = centeredSmoothedPoint(samples, anchor.t, windowMs);
    return {
      ...anchor,
      correction: {
        x: anchor.x - smoothed.x,
        y: anchor.y - smoothed.y,
      },
    };
  });
}

function interpolatedCorrection(
  anchors: CorrectionAnchor[],
  time: number,
): Point {
  if (anchors.length === 0) return { x: 0, y: 0 };
  if (anchors.length === 1 || time <= anchors[0].t) {
    return anchors[0].correction;
  }

  const last = anchors[anchors.length - 1];
  if (time >= last.t) return last.correction;

  let low = 0;
  let high = anchors.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (anchors[middle].t <= time) low = middle;
    else high = middle;
  }

  const start = anchors[low];
  const end = anchors[high];
  const span = end.t - start.t;
  const amount = span <= EPSILON ? 1 : (time - start.t) / span;
  return {
    x: lerp(start.correction.x, end.correction.x, amount),
    y: lerp(start.correction.y, end.correction.y, amount),
  };
}

type ActivitySample = { t: number; x: number; y: number; click: boolean };
type CursorKindSample = { t: number; cursor: CursorKind };
type VisibilityTransition = {
  t: number;
  from: number;
  target: number;
};
type PreparedCursorPath = { anchors: CorrectionAnchor[] };
type PreparedCaptureTimeline = {
  positions: PositionSample[];
  pointers: CursorKindSample[];
  visibility: PointerVisibilitySample[];
  activity: ActivitySample[];
  cursorPaths: Map<number, PreparedCursorPath>;
  visibilityTransitions: Map<number, VisibilityTransition[]>;
};

const captureTimelineCache = new WeakMap<CaptureEvent[], PreparedCaptureTimeline>();

function lastIndexAtOrBefore<T extends { t: number }>(
  values: T[],
  time: number,
): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle].t <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function pointerSamples(events: CaptureEvent[]): CursorKindSample[] {
  return events
    .map((event, order) => ({ event, order }))
    .filter(
      (entry): entry is { event: PointerSample; order: number } =>
        entry.event.type === "pointer" && Number.isFinite(entry.event.t),
    )
    .sort(
      (left, right) =>
        left.event.t - right.event.t || left.order - right.order,
    )
    .map(({ event }) => ({ t: event.t, cursor: event.cursor }));
}

function visibilitySamples(events: CaptureEvent[]): PointerVisibilitySample[] {
  return events
    .map((event, order) => ({ event, order }))
    .filter(
      (entry): entry is { event: PointerVisibilitySample; order: number } =>
        entry.event.type === "visibility" && Number.isFinite(entry.event.t),
    )
    .sort(
      (left, right) =>
        left.event.t - right.event.t || left.order - right.order,
    )
    .map(({ event }) => ({
      type: "visibility" as const,
      t: event.t,
      visible: event.visible,
    }));
}

function movementSamples(events: CaptureEvent[]): ActivitySample[] {
  const sorted = events
    .map((event, order) => ({ event, order }))
    .filter(
      (entry): entry is {
        event: PointerSample | ClickSample;
        order: number;
      } => isFinitePositionEvent(entry.event),
    )
    .sort(
      (left, right) =>
        left.event.t - right.event.t || left.order - right.order,
    );
  const movements: ActivitySample[] = [];
  let previousPointer: PointerSample | undefined;

  for (const { event } of sorted) {
    if (event.type === "click") {
      movements.push({ ...normalizedPoint(event), t: event.t, click: true });
      continue;
    }

    if (
      !previousPointer ||
      Math.abs(event.x - previousPointer.x) > EPSILON ||
      Math.abs(event.y - previousPointer.y) > EPSILON
    ) {
      movements.push({ ...normalizedPoint(event), t: event.t, click: false });
    }
    previousPointer = event;
  }

  return movements;
}

function preparedCaptureTimeline(events: CaptureEvent[]): PreparedCaptureTimeline {
  const cached = captureTimelineCache.get(events);
  if (cached) return cached;

  const prepared: PreparedCaptureTimeline = {
    positions: positionSamples(events),
    pointers: pointerSamples(events),
    visibility: visibilitySamples(events),
    activity: movementSamples(events),
    cursorPaths: new Map(),
    visibilityTransitions: new Map(),
  };
  captureTimelineCache.set(events, prepared);
  return prepared;
}

function preparedCursorPath(
  timeline: PreparedCaptureTimeline,
  windowMs: number,
): PreparedCursorPath {
  const cached = timeline.cursorPaths.get(windowMs);
  if (cached) return cached;
  const prepared = {
    anchors: correctionAnchors(timeline.positions, windowMs),
  };
  timeline.cursorPaths.set(windowMs, prepared);
  return prepared;
}

function cursorPositionFromTimeline(
  timeline: PreparedCaptureTimeline,
  time: number,
  smoothing: number,
): Point {
  const samples = timeline.positions;
  if (samples.length === 0) return { x: 0.5, y: 0.5 };

  const t = normalizeTime(time);
  const windowMs = smoothingWindowMs(smoothing);
  if (windowMs <= EPSILON) return interpolateSamples(samples, t);

  const sampleIndex = lastIndexAtOrBefore(samples, t);
  const exactCandidates = [samples[sampleIndex], samples[sampleIndex + 1]];
  const exactClick = exactCandidates.find(
    (sample) => sample?.click && Math.abs(sample.t - t) <= EPSILON,
  );
  if (exactClick) return normalizedPoint(exactClick);

  const smoothed = centeredSmoothedPoint(samples, t, windowMs);
  const correction = interpolatedCorrection(
    preparedCursorPath(timeline, windowMs).anchors,
    t,
  );
  return normalizedPoint({
    x: smoothed.x + correction.x,
    y: smoothed.y + correction.y,
  });
}

function cursorKindFromTimeline(
  timeline: PreparedCaptureTimeline,
  time: number,
): CursorKind {
  const index = lastIndexAtOrBefore(timeline.pointers, normalizeTime(time));
  return index < 0 ? "default" : timeline.pointers[index].cursor;
}

function evaluateVisibilityTransition(
  transition: VisibilityTransition,
  time: number,
  fadeMs: number,
): number {
  if (fadeMs <= EPSILON) return transition.target;
  return lerp(
    transition.from,
    transition.target,
    smoothstep((time - transition.t) / fadeMs),
  );
}

function preparedVisibilityTransitions(
  timeline: PreparedCaptureTimeline,
  fadeMs: number,
): VisibilityTransition[] {
  const cached = timeline.visibilityTransitions.get(fadeMs);
  if (cached) return cached;

  const transitions: VisibilityTransition[] = [];
  for (const sample of timeline.visibility) {
    const previous = transitions.at(-1);
    const from = previous
      ? evaluateVisibilityTransition(previous, sample.t, fadeMs)
      : 1;
    transitions.push({
      t: sample.t,
      from,
      target: sample.visible ? 1 : 0,
    });
  }
  timeline.visibilityTransitions.set(fadeMs, transitions);
  return transitions;
}

function recordedVisibilityFromTimeline(
  timeline: PreparedCaptureTimeline,
  time: number,
  fadeMs: number,
): number {
  const transitions = preparedVisibilityTransitions(timeline, fadeMs);
  const index = lastIndexAtOrBefore(transitions, normalizeTime(time));
  if (index < 0) return 1;
  return clamp(
    evaluateVisibilityTransition(transitions[index], normalizeTime(time), fadeMs),
  );
}

function idleOpacityFromTimeline(
  timeline: PreparedCaptureTimeline,
  time: number,
  idleDelay: number,
  fadeMs: number,
): number {
  const t = normalizeTime(time);
  const index = lastIndexAtOrBefore(timeline.activity, t);
  if (index < 0) return 1;

  const delay = Math.max(0, Number.isFinite(idleDelay) ? idleDelay : 0);
  const idleFor = t - timeline.activity[index].t;
  if (idleFor <= delay) return 1;
  if (fadeMs <= EPSILON) return 0;
  return clamp(1 - smoothstep((idleFor - delay) / fadeMs));
}

/**
 * Interpolate and symmetrically smooth normalized cursor telemetry. Clicks are
 * correction anchors, so the rendered cursor lands exactly on every click even
 * at maximum smoothing. Event arrays are treated as immutable and compiled once.
 */
export function cursorPositionAt(
  events: CaptureEvent[],
  time: number,
  smoothing = 0,
): Point {
  return cursorPositionFromTimeline(
    preparedCaptureTimeline(events),
    time,
    smoothing,
  );
}

/** The most recently observed CSS cursor kind at a timeline position. */
export function cursorKindAt(
  events: CaptureEvent[],
  time: number,
): CursorKind {
  return cursorKindFromTimeline(preparedCaptureTimeline(events), time);
}

/** Smoothly apply pointer-enter/pointer-leave visibility telemetry. */
export function recordedVisibilityOpacityAt(
  events: CaptureEvent[],
  time: number,
  fadeMs = DEFAULT_CURSOR_FADE_MS,
): number {
  const fade = Math.max(0, Number.isFinite(fadeMs) ? fadeMs : 0);
  return recordedVisibilityFromTimeline(
    preparedCaptureTimeline(events),
    time,
    fade,
  );
}

/** Fade after the pointer has not moved or clicked for idleDelay milliseconds. */
export function idleOpacityAt(
  events: CaptureEvent[],
  time: number,
  idleDelay: number,
  fadeMs = DEFAULT_IDLE_FADE_MS,
): number {
  const fade = Math.max(0, Number.isFinite(fadeMs) ? fadeMs : 0);
  return idleOpacityFromTimeline(
    preparedCaptureTimeline(events),
    time,
    idleDelay,
    fade,
  );
}

type TimeRange = { start: number; end: number };

const hiddenRangeCache = new WeakMap<HiddenCursorRange[], TimeRange[]>();

function mergedHiddenRanges(ranges: HiddenCursorRange[]): TimeRange[] {
  const cached = hiddenRangeCache.get(ranges);
  if (cached) return cached;

  const normalized = ranges
    .filter(
      (range) => Number.isFinite(range.start) && Number.isFinite(range.end),
    )
    .map((range) => ({
      start: Math.max(0, Math.min(range.start, range.end)),
      end: Math.max(0, Math.max(range.start, range.end)),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: TimeRange[] = [];
  for (const range of normalized) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + EPSILON) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  hiddenRangeCache.set(ranges, merged);
  return merged;
}

/**
 * Cursor-hidden ranges are completely opaque to the cursor within the range and
 * ease just outside either boundary. Overlapping ranges behave as one union.
 */
export function hiddenRangeOpacityAt(
  ranges: HiddenCursorRange[],
  time: number,
  fadeMs = DEFAULT_CURSOR_FADE_MS,
): number {
  const merged = mergedHiddenRanges(ranges);
  if (merged.length === 0) return 1;

  const t = normalizeTime(time);
  const fade = Math.max(0, Number.isFinite(fadeMs) ? fadeMs : 0);
  let low = 0;
  let high = merged.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (merged[middle].start <= t) low = middle + 1;
    else high = middle;
  }

  const previous = merged[low - 1];
  const next = merged[low];
  if (previous && t <= previous.end) return 0;
  if (fade <= EPSILON) return 1;

  let opacity = 1;
  if (previous && t - previous.end < fade) {
    opacity = Math.min(opacity, smoothstep((t - previous.end) / fade));
  }
  if (next && next.start - t < fade) {
    opacity = Math.min(opacity, smoothstep((next.start - t) / fade));
  }
  return clamp(opacity);
}

function cursorOpacityFromTimeline(
  timeline: PreparedCaptureTimeline,
  hiddenRanges: HiddenCursorRange[],
  time: number,
  settings: CursorSettings,
  fadeMs: number,
  sampledKind?: CursorKind,
): number {
  const kind = sampledKind ?? cursorKindFromTimeline(timeline, time);
  if (!settings.visible || kind === "hidden") {
    return 0;
  }
  if (timeline.positions.length === 0) return 0;

  const recorded = recordedVisibilityFromTimeline(timeline, time, fadeMs);
  const hidden = hiddenRangeOpacityAt(hiddenRanges, time, fadeMs);
  const idle = settings.hideWhenIdle
    ? idleOpacityFromTimeline(timeline, time, settings.idleDelay, fadeMs)
    : 1;
  return clamp(recorded * hidden * idle);
}

/** Compose project visibility, recorded visibility, idle fade, and edit ranges. */
export function cursorOpacityAt(
  events: CaptureEvent[],
  hiddenRanges: HiddenCursorRange[],
  time: number,
  settings: CursorSettings,
  fadeMs = DEFAULT_CURSOR_FADE_MS,
): number {
  const fade = Math.max(0, Number.isFinite(fadeMs) ? fadeMs : 0);
  return cursorOpacityFromTimeline(
    preparedCaptureTimeline(events),
    hiddenRanges,
    time,
    settings,
    fade,
  );
}

export function cursorStateAt(
  events: CaptureEvent[],
  hiddenRanges: HiddenCursorRange[],
  time: number,
  settings: CursorSettings,
): CursorState {
  const timeline = preparedCaptureTimeline(events);
  const kind = cursorKindFromTimeline(timeline, time);
  const opacity = cursorOpacityFromTimeline(
    timeline,
    hiddenRanges,
    time,
    settings,
    DEFAULT_CURSOR_FADE_MS,
    kind,
  );
  return {
    position: cursorPositionFromTimeline(timeline, time, settings.smoothing),
    kind,
    opacity,
    visible: opacity > EPSILON,
  };
}

type AutoZoomCluster = {
  clicks: ClickSample[];
  start: number;
  end: number;
};

function autoZoomScale(defaultScale: number): number {
  return clamp(
    Math.max(1.6, defaultScale + 0.55, defaultScale * 1.55),
    1,
    4,
  );
}

/** Generate deterministic edit ranges around clicks, joining nearby clicks. */
export function generateAutoZooms(
  events: CaptureEvent[],
  duration: number,
  settings: Partial<CameraSettings> = {},
): ZoomSegment[] {
  if (settings.autoZoom === false) return [];

  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  if (safeDuration <= EPSILON) return [];

  const clicks = events
    .filter(
      (event): event is ClickSample =>
        event.type === "click" &&
        Number.isFinite(event.t) &&
        Number.isFinite(event.x) &&
        Number.isFinite(event.y) &&
        event.t >= 0 &&
        event.t <= safeDuration,
    )
    .map((click) => ({ ...click, ...normalizedPoint(click) }))
    .sort((left, right) => left.t - right.t);

  const clusters: AutoZoomCluster[] = [];
  for (const click of clicks) {
    const start = Math.max(0, click.t - AUTO_ZOOM_LEAD_MS);
    const end = Math.min(safeDuration, click.t + AUTO_ZOOM_TAIL_MS);
    const previous = clusters.at(-1);

    if (previous && start <= previous.end + AUTO_ZOOM_MERGE_GAP_MS) {
      previous.clicks.push(click);
      previous.end = Math.max(previous.end, end);
    } else {
      clusters.push({ clicks: [click], start, end });
    }
  }

  const defaultScale = clamp(
    settings.defaultScale ?? DEFAULT_CAMERA_SETTINGS.defaultScale,
    1,
    MAX_CAMERA_SCALE,
  );

  return clusters
    .filter((cluster) => cluster.end - cluster.start > EPSILON)
    .map((cluster, index) => {
      const count = cluster.clicks.length;
      const target = normalizedPoint({
        x: cluster.clicks.reduce((sum, click) => sum + click.x, 0) / count,
        y: cluster.clicks.reduce((sum, click) => sum + click.y, 0) / count,
      });

      return {
        id: `auto-${index}-${Math.round(cluster.clicks[0].t)}`,
        kind: "auto" as const,
        start: cluster.start,
        end: cluster.end,
        scale: autoZoomScale(defaultScale),
        target,
        follow: true,
      };
    });
}

function safeCameraSettings(
  settings: Partial<CameraSettings>,
): CameraSettings {
  return {
    autoZoom: settings.autoZoom ?? DEFAULT_CAMERA_SETTINGS.autoZoom,
    defaultScale: clamp(
      settings.defaultScale ?? DEFAULT_CAMERA_SETTINGS.defaultScale,
      1,
      MAX_CAMERA_SCALE,
    ),
    transitionMs: Math.max(
      0,
      Number.isFinite(settings.transitionMs)
        ? (settings.transitionMs as number)
        : DEFAULT_CAMERA_SETTINGS.transitionMs,
    ),
    followStrength: clamp(
      settings.followStrength ?? DEFAULT_CAMERA_SETTINGS.followStrength,
    ),
    deadZone: clamp(settings.deadZone ?? DEFAULT_CAMERA_SETTINGS.deadZone),
  };
}

function validZoomSegment(segment: ZoomSegment): boolean {
  return (
    Number.isFinite(segment.start) &&
    Number.isFinite(segment.end) &&
    segment.end > segment.start &&
    Number.isFinite(segment.scale) &&
    Number.isFinite(segment.target.x) &&
    Number.isFinite(segment.target.y)
  );
}

function zoomProgress(
  segment: ZoomSegment,
  time: number,
  transitionMs: number,
): number {
  if (time < segment.start || time > segment.end) return 0;
  if (segment.instant || transitionMs <= EPSILON) return 1;

  const transition = Math.min(
    transitionMs,
    Math.max(0, (segment.end - segment.start) / 2),
  );
  if (transition <= EPSILON) return 1;

  const entering = smoothstep((time - segment.start) / transition);
  const leaving = smoothstep((segment.end - time) / transition);
  return clamp(Math.min(entering, leaving));
}

type WeightedZoom = { segment: ZoomSegment; progress: number; order: number };

type PreparedZoomTimeline = {
  automatic: Array<{ segment: ZoomSegment; order: number }>;
  manual: Array<{ segment: ZoomSegment; order: number }>;
};

type ResolvedZoomState = ZoomState & { followAmount: number };

const zoomTimelineCache = new WeakMap<ZoomSegment[], PreparedZoomTimeline>();

function preparedZoomTimeline(zooms: ZoomSegment[]): PreparedZoomTimeline {
  const cached = zoomTimelineCache.get(zooms);
  if (cached) return cached;

  const prepared: PreparedZoomTimeline = { automatic: [], manual: [] };
  zooms.forEach((segment, order) => {
    if (!validZoomSegment(segment)) return;
    const entry = { segment, order };
    if (segment.kind === "manual") prepared.manual.push(entry);
    else prepared.automatic.push(entry);
  });
  prepared.manual.sort(
    (left, right) =>
      left.segment.start - right.segment.start || left.order - right.order,
  );
  zoomTimelineCache.set(zooms, prepared);
  return prepared;
}

function dominantAutomaticZoom(
  zooms: PreparedZoomTimeline["automatic"],
  time: number,
  transitionMs: number,
): WeightedZoom | undefined {
  let chosen: WeightedZoom | undefined;
  for (const { segment, order } of zooms) {
    const progress = zoomProgress(segment, time, transitionMs);
    if (progress <= EPSILON) continue;
    if (
      !chosen ||
      progress > chosen.progress + EPSILON ||
      (Math.abs(progress - chosen.progress) <= EPSILON &&
        (segment.start > chosen.segment.start ||
          (segment.start === chosen.segment.start && order > chosen.order)))
    ) {
      chosen = { segment, progress, order };
    }
  }
  return chosen;
}

function resolvedZoomStateAt(
  zooms: ZoomSegment[],
  time: number,
  settings: Partial<CameraSettings>,
): ResolvedZoomState {
  const safeSettings = safeCameraSettings(settings);
  const timeline = preparedZoomTimeline(zooms);
  const t = normalizeTime(time);
  const defaultTarget = { x: 0.5, y: 0.5 };
  const activeAutomatic = safeSettings.autoZoom
    ? dominantAutomaticZoom(
        timeline.automatic,
        t,
        safeSettings.transitionMs,
      )
    : undefined;

  let state: ResolvedZoomState = {
    scale: safeSettings.defaultScale,
    target: defaultTarget,
    follow: false,
    followAmount: 0,
    progress: 0,
    segmentId: null,
  };

  if (activeAutomatic) {
    const { segment, progress } = activeAutomatic;
    state = {
      scale: clamp(
        lerp(
          safeSettings.defaultScale,
          clamp(segment.scale, 1, MAX_CAMERA_SCALE),
          progress,
        ),
        1,
        MAX_CAMERA_SCALE,
      ),
      target: pointLerp(defaultTarget, normalizedPoint(segment.target), progress),
      follow: segment.follow,
      followAmount: segment.follow ? progress : 0,
      progress: clamp(progress),
      segmentId: segment.id,
    };
  }

  // Manual ranges are composited chronologically over the automatic camera.
  // Their easing therefore reveals the underlying zoom instead of jumping to
  // the global default at the first/last millisecond of an overlap.
  for (const { segment } of timeline.manual) {
    const progress = zoomProgress(segment, t, safeSettings.transitionMs);
    if (progress <= EPSILON) continue;

    const followAmount = lerp(
      state.followAmount,
      segment.follow ? 1 : 0,
      progress,
    );
    state = {
      scale: clamp(
        lerp(
          state.scale,
          clamp(segment.scale, 1, MAX_CAMERA_SCALE),
          progress,
        ),
        1,
        MAX_CAMERA_SCALE,
      ),
      target: pointLerp(
        state.target,
        normalizedPoint(segment.target),
        progress,
      ),
      follow: followAmount > EPSILON,
      followAmount,
      progress: clamp(progress),
      segmentId: segment.id,
    };
  }

  return state;
}

/** Resolve active zoom layers and their eased transitions. */
export function zoomStateAt(
  zooms: ZoomSegment[],
  time: number,
  settings: Partial<CameraSettings> = {},
): ZoomState {
  const { followAmount: _followAmount, ...state } = resolvedZoomStateAt(
    zooms,
    time,
    settings,
  );
  return state;
}

function followAxis(
  center: number,
  cursor: number,
  cropSize: number,
  deadZone: number,
  strength: number,
): number {
  const halfZone = (cropSize * deadZone) / 2;
  const minimum = center - halfZone;
  const maximum = center + halfZone;
  if (cursor < minimum) return center + (cursor - minimum) * strength;
  if (cursor > maximum) return center + (cursor - maximum) * strength;
  return center;
}

/**
 * Calculate a bounded virtual camera. `source` is the normalized rectangle to
 * sample from the raw recording and is safe to pass directly to drawImage.
 */
export function cameraStateAt(
  zooms: ZoomSegment[],
  time: number,
  cursor: Point | null | undefined,
  settings: Partial<CameraSettings> = {},
): CameraState {
  const safeSettings = safeCameraSettings(settings);
  const { followAmount, ...zoom } = resolvedZoomStateAt(
    zooms,
    time,
    safeSettings,
  );
  const scale = clamp(zoom.scale, 1, MAX_CAMERA_SCALE);
  const cropSize = clamp(1 / scale, 1 / MAX_CAMERA_SCALE, 1);
  let center = normalizedPoint(zoom.target);

  if (followAmount > EPSILON && cursor) {
    const safeCursor = normalizedPoint(cursor);
    const strength = safeSettings.followStrength * followAmount;
    center = {
      x: followAxis(
        center.x,
        safeCursor.x,
        cropSize,
        safeSettings.deadZone,
        strength,
      ),
      y: followAxis(
        center.y,
        safeCursor.y,
        cropSize,
        safeSettings.deadZone,
        strength,
      ),
    };
  }

  const half = cropSize / 2;
  center = {
    x: clamp(center.x, half, 1 - half),
    y: clamp(center.y, half, 1 - half),
  };

  const source = {
    x: clamp(center.x - half, 0, 1 - cropSize),
    y: clamp(center.y - half, 0, 1 - cropSize),
    width: cropSize,
    height: cropSize,
  };

  return {
    ...zoom,
    scale,
    center: normalizedPoint(center),
    source,
  };
}

/** Convenience wrapper for consumers that already own the capture event list. */
export function cameraStateForEventsAt(
  zooms: ZoomSegment[],
  events: CaptureEvent[],
  time: number,
  cameraSettings: Partial<CameraSettings> = {},
  cursorSmoothing = 0,
): CameraState {
  return cameraStateAt(
    zooms,
    time,
    cursorPositionAt(events, time, cursorSmoothing),
    cameraSettings,
  );
}
