import type {
  ClickSample,
  CursorKind,
  PointerSample,
  Point,
  Project,
  ZoomSegment,
} from "../shared/types";
import { effectsAt } from "./effectsAdapter";
import { clamp, lerp, smoothstep } from "./utils";

export type Rect = { x: number; y: number; width: number; height: number };

export type FrameComposition = {
  frame: Rect;
  crop: Rect;
  sourceWidth: number;
  sourceHeight: number;
  camera: Point;
  scale: number;
  cursor: (Point & { alpha: number; kind: CursorKind }) | null;
};

const pointersFor = (project: Project) =>
  project.events.filter((event): event is PointerSample => event.type === "pointer");

const clicksFor = (project: Project) =>
  project.events.filter((event): event is ClickSample => event.type === "click");

function pointerAt(project: Project, time: number) {
  const pointers = pointersFor(project);
  if (!pointers.length) return null;

  let low = 0;
  let high = pointers.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (pointers[middle].t <= time) low = middle;
    else high = middle - 1;
  }

  const previous = pointers[low];
  const next = pointers[Math.min(low + 1, pointers.length - 1)];
  const span = Math.max(1, next.t - previous.t);
  const amount = smoothstep((time - previous.t) / span);
  let x = lerp(previous.x, next.x, amount);
  let y = lerp(previous.y, next.y, amount);

  // A centered weighted window removes capture jitter without creating permanent lag.
  const radius = clamp(project.cursor.smoothing, 0, 1) * 150;
  if (radius > 2) {
    let totalWeight = 1;
    let weightedX = x;
    let weightedY = y;
    const start = Math.max(0, low - 8);
    const end = Math.min(pointers.length - 1, low + 9);
    for (let index = start; index <= end; index += 1) {
      const sample = pointers[index];
      const distance = Math.abs(sample.t - time);
      if (distance > radius) continue;
      const weight = Math.pow(1 - distance / radius, 2) * 1.8;
      weightedX += sample.x * weight;
      weightedY += sample.y * weight;
      totalWeight += weight;
    }
    x = weightedX / totalWeight;
    y = weightedY / totalWeight;
  }

  // Preserve click accuracy even at high smoothing values.
  const click = clicksFor(project).find((event) => Math.abs(event.t - time) < 70);
  if (click) {
    const anchor = 1 - Math.abs(click.t - time) / 70;
    x = lerp(x, click.x, anchor);
    y = lerp(y, click.y, anchor);
  }

  const lastMovement = previous.t <= time ? previous.t : time;
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    kind: amount < 0.5 ? previous.cursor : next.cursor,
    lastMovement,
  };
}

function pointerVisibility(project: Project, time: number) {
  let visible = true;
  for (const event of project.events) {
    if (event.t > time) break;
    if (event.type === "visibility") visible = event.visible;
  }
  return visible;
}

function cursorAlpha(project: Project, time: number, lastMovement: number) {
  if (!project.cursor.visible || !pointerVisibility(project, time)) return 0;
  let alpha = 1;
  if (project.cursor.hideWhenIdle) {
    const idleFor = time - lastMovement - Math.max(0, project.cursor.idleDelay);
    if (idleFor > 0) alpha *= 1 - smoothstep(idleFor / 180);
  }
  for (const range of project.hiddenCursorRanges) {
    const fade = Math.min(120, Math.max(30, (range.end - range.start) / 4));
    if (time >= range.start && time <= range.end) {
      const atStart = smoothstep((time - range.start) / fade);
      const atEnd = smoothstep((range.end - time) / fade);
      alpha *= 1 - Math.min(atStart, atEnd);
    }
  }
  return clamp(alpha, 0, 1);
}

function segmentWeight(segment: ZoomSegment, time: number, transition: number) {
  if (time < segment.start - transition || time > segment.end + transition) return 0;
  if (segment.instant) return time >= segment.start && time <= segment.end ? 1 : 0;
  if (time < segment.start) return smoothstep(1 - (segment.start - time) / transition);
  if (time > segment.end) return smoothstep(1 - (time - segment.end) / transition);
  const intro = smoothstep((time - segment.start) / transition);
  const outro = smoothstep((segment.end - time) / transition);
  return Math.min(1, Math.max(intro, outro));
}

function cameraAt(project: Project, time: number, pointer: Point | null) {
  const transition = Math.max(40, project.camera.transitionMs);
  let chosen: ZoomSegment | null = null;
  let weight = 0;
  for (const segment of project.zooms) {
    if (segment.kind === "auto" && !project.camera.autoZoom) continue;
    const candidate = segmentWeight(segment, time, transition);
    if (candidate >= weight) {
      chosen = segment;
      weight = candidate;
    }
  }

  const defaultScale = clamp(project.camera.defaultScale || 1, 1, 4);
  const segmentScale = chosen ? clamp(chosen.scale, 1, 4) : defaultScale;
  const scale = lerp(defaultScale, segmentScale, weight);
  let x = lerp(0.5, chosen?.target.x ?? 0.5, weight);
  let y = lerp(0.5, chosen?.target.y ?? 0.5, weight);

  if (chosen?.follow && pointer && weight > 0) {
    const deadZone = clamp(project.camera.deadZone, 0, 0.45);
    const strength = clamp(project.camera.followStrength, 0, 1) * weight;
    const followAxis = (center: number, value: number) => {
      const delta = value - center;
      if (Math.abs(delta) <= deadZone) return center;
      const outside = delta - Math.sign(delta) * deadZone;
      return center + outside * strength;
    };
    x = followAxis(x, pointer.x);
    y = followAxis(y, pointer.y);
  }

  const half = 0.5 / scale;
  return {
    scale,
    camera: { x: clamp(x, half, 1 - half), y: clamp(y, half, 1 - half) },
  };
}

function frameRect(
  project: Project,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): Rect {
  const scale = width / 1280;
  const padding = clamp(project.frame.padding * scale, 0, Math.min(width, height) * 0.4);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const sourceRatio = Math.max(0.01, sourceWidth / Math.max(1, sourceHeight));
  let frameWidth = availableWidth;
  let frameHeight = frameWidth / sourceRatio;
  if (frameHeight > availableHeight) {
    frameHeight = availableHeight;
    frameWidth = frameHeight * sourceRatio;
  }
  return {
    x: (width - frameWidth) / 2,
    y: (height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

export function getFrameComposition(
  project: Project,
  time: number,
  width: number,
  height: number,
  sourceWidth = project.sourceWidth,
  sourceHeight = project.sourceHeight,
): FrameComposition {
  const effects = effectsAt(project, time);
  const scale = effects.camera.scale;
  const camera = effects.camera.center;
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const cropWidth = effects.camera.source.width * safeSourceWidth;
  const cropHeight = effects.camera.source.height * safeSourceHeight;
  const crop = {
    x: effects.camera.source.x * safeSourceWidth,
    y: effects.camera.source.y * safeSourceHeight,
    width: cropWidth,
    height: cropHeight,
  };
  return {
    frame: frameRect(project, width, height, safeSourceWidth, safeSourceHeight),
    crop,
    sourceWidth: safeSourceWidth,
    sourceHeight: safeSourceHeight,
    camera,
    scale,
    cursor: effects.cursor.visible
      ? {
          x: effects.cursor.position.x,
          y: effects.cursor.position.y,
          kind: effects.cursor.kind,
          alpha: effects.cursor.opacity,
        }
      : null,
  };
}

function roundedRect(context: CanvasRenderingContext2D, rect: Rect, radius: number) {
  const r = clamp(radius, 0, Math.min(rect.width, rect.height) / 2);
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, r);
}

function fillBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: string,
) {
  const presets: Record<string, [string, string, string?]> = {
    aurora: ["#19152f", "#6948d9", "#23a9a1"],
    midnight: ["#0a0b12", "#20243b"],
    sunset: ["#351b45", "#d05762", "#e8a45e"],
    ocean: ["#0c2537", "#176b87", "#35a6a0"],
  };
  const colors = presets[background];
  if (colors) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.58, colors[1]);
    gradient.addColorStop(1, colors[2] ?? colors[1]);
    context.fillStyle = gradient;
  } else {
    context.fillStyle = /^#[\da-f]{3,8}$/i.test(background) ? background : "#16171d";
  }
  context.fillRect(0, 0, width, height);
}

function cursorScreenPoint(
  point: Point,
  composition: FrameComposition,
) {
  const sourceX = point.x * composition.sourceWidth;
  const sourceY = point.y * composition.sourceHeight;
  return {
    x:
      composition.frame.x +
      ((sourceX - composition.crop.x) / composition.crop.width) * composition.frame.width,
    y:
      composition.frame.y +
      ((sourceY - composition.crop.y) / composition.crop.height) * composition.frame.height,
  };
}

function drawCursor(
  context: CanvasRenderingContext2D,
  position: Point,
  kind: CursorKind,
  size: number,
  alpha: number,
) {
  if (kind === "hidden" || alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  context.translate(position.x, position.y);
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowColor = "rgba(0,0,0,.42)";
  context.shadowBlur = size * 0.15;
  context.shadowOffsetY = size * 0.08;

  if (kind === "text") {
    context.strokeStyle = "white";
    context.lineWidth = size * 0.18;
    context.beginPath();
    context.moveTo(0, -size * 0.45);
    context.lineTo(0, size * 0.45);
    context.moveTo(-size * 0.18, -size * 0.45);
    context.lineTo(size * 0.18, -size * 0.45);
    context.moveTo(-size * 0.18, size * 0.45);
    context.lineTo(size * 0.18, size * 0.45);
    context.stroke();
  } else if (kind === "crosshair") {
    context.strokeStyle = "white";
    context.lineWidth = Math.max(2, size * 0.09);
    context.beginPath();
    context.arc(0, 0, size * 0.24, 0, Math.PI * 2);
    context.moveTo(-size * 0.48, 0);
    context.lineTo(size * 0.48, 0);
    context.moveTo(0, -size * 0.48);
    context.lineTo(0, size * 0.48);
    context.stroke();
  } else if (kind === "pointer") {
    context.fillStyle = "white";
    context.strokeStyle = "#151515";
    context.lineWidth = Math.max(1.5, size * 0.055);
    context.beginPath();
    context.roundRect(-size * 0.18, -size * 0.45, size * 0.38, size * 0.76, size * 0.15);
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(-size * 0.18, -size * 0.1);
    context.lineTo(-size * 0.36, -size * 0.02);
    context.lineTo(-size * 0.22, size * 0.1);
    context.closePath();
    context.fill();
    context.stroke();
  } else {
    context.fillStyle = "white";
    context.strokeStyle = "#151515";
    context.lineWidth = Math.max(1.5, size * 0.065);
    context.beginPath();
    context.moveTo(-size * 0.22, -size * 0.48);
    context.lineTo(size * 0.32, size * 0.16);
    context.lineTo(size * 0.04, size * 0.17);
    context.lineTo(size * 0.2, size * 0.48);
    context.lineTo(size * 0.02, size * 0.56);
    context.lineTo(-size * 0.14, size * 0.23);
    context.lineTo(-size * 0.35, size * 0.42);
    context.closePath();
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawClickRipple(
  context: CanvasRenderingContext2D,
  project: Project,
  composition: FrameComposition,
  time: number,
  cursorOpacity: number,
) {
  if (!project.cursor.clickRipple || cursorOpacity <= 0) return;
  const click = clicksFor(project)
    .filter((event) => event.t <= time && time - event.t < 520)
    .at(-1);
  if (!click) return;
  const progress = clamp((time - click.t) / 520, 0, 1);
  const position = cursorScreenPoint(click, composition);
  const radius = lerp(8, 38, smoothstep(progress)) * (context.canvas.width / 1280);
  context.save();
  roundedRect(context, composition.frame, project.frame.cornerRadius);
  context.clip();
  context.globalAlpha = (1 - progress) * 0.65 * cursorOpacity;
  context.strokeStyle = "#b8a5ff";
  context.lineWidth = Math.max(2, context.canvas.width / 500);
  context.beginPath();
  context.arc(position.x, position.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}

export function drawCompositedFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource | null,
  project: Project,
  time: number,
) {
  const { width, height } = context.canvas;
  const mediaSize = source as unknown as {
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  } | null;
  const sourceWidth =
    mediaSize?.videoWidth || mediaSize?.naturalWidth || mediaSize?.width || project.sourceWidth;
  const sourceHeight =
    mediaSize?.videoHeight || mediaSize?.naturalHeight || mediaSize?.height || project.sourceHeight;
  const composition = getFrameComposition(
    project,
    time,
    width,
    height,
    sourceWidth,
    sourceHeight,
  );
  fillBackground(context, width, height, project.frame.background);

  const radius = project.frame.cornerRadius * (width / 1280);
  const shadow = clamp(project.frame.shadow, 0, 1) * 62 * (width / 1280);
  context.save();
  if (shadow > 0) {
    context.shadowColor = "rgba(0,0,0,.52)";
    context.shadowBlur = shadow;
    context.shadowOffsetY = shadow * 0.3;
    context.fillStyle = "rgba(12,12,16,.92)";
    roundedRect(context, composition.frame, radius);
    context.fill();
  }
  roundedRect(context, composition.frame, radius);
  context.clip();
  context.shadowColor = "transparent";
  if (source) {
    try {
      context.drawImage(
        source,
        composition.crop.x,
        composition.crop.y,
        composition.crop.width,
        composition.crop.height,
        composition.frame.x,
        composition.frame.y,
        composition.frame.width,
        composition.frame.height,
      );
    } catch {
      context.fillStyle = "#111218";
      context.fillRect(
        composition.frame.x,
        composition.frame.y,
        composition.frame.width,
        composition.frame.height,
      );
    }
  } else {
    context.fillStyle = "#111218";
    context.fillRect(
      composition.frame.x,
      composition.frame.y,
      composition.frame.width,
      composition.frame.height,
    );
  }
  context.restore();

  if (composition.cursor) {
    drawClickRipple(
      context,
      project,
      composition,
      time,
      composition.cursor.alpha,
    );
  }
  if (composition.cursor) {
    const position = cursorScreenPoint(composition.cursor, composition);
    if (
      position.x >= composition.frame.x - 2 &&
      position.x <= composition.frame.x + composition.frame.width + 2 &&
      position.y >= composition.frame.y - 2 &&
      position.y <= composition.frame.y + composition.frame.height + 2
    ) {
      const normalizedSize = project.cursor.size > 5
        ? project.cursor.size / 100
        : project.cursor.size;
      const size = 34 * clamp(normalizedSize || 1, 0.35, 3) * (width / 1280);
      drawCursor(
        context,
        position,
        composition.cursor.kind,
        size,
        composition.cursor.alpha,
      );
    }
  }
  return composition;
}

export function canvasPointToSource(
  canvasPoint: Point,
  composition: FrameComposition,
  project: Project,
) {
  const withinFrame =
    canvasPoint.x >= composition.frame.x &&
    canvasPoint.x <= composition.frame.x + composition.frame.width &&
    canvasPoint.y >= composition.frame.y &&
    canvasPoint.y <= composition.frame.y + composition.frame.height;
  if (!withinFrame) return null;
  const sourceX =
    composition.crop.x +
    ((canvasPoint.x - composition.frame.x) / composition.frame.width) * composition.crop.width;
  const sourceY =
    composition.crop.y +
    ((canvasPoint.y - composition.frame.y) / composition.frame.height) * composition.crop.height;
  return {
    x: clamp(sourceX / composition.sourceWidth, 0, 1),
    y: clamp(sourceY / composition.sourceHeight, 0, 1),
  };
}
