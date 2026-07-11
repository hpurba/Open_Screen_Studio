import type { Point } from "./types";

/** Where the most recent page frame landed on the fixed-size recorder canvas. */
export type CanvasContentRect = {
  canvasWidth: number;
  canvasHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const clampUnit = (value: number) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** Fit a frame inside the canvas (contain, centered) without upscaling checks. */
export function containRect(
  canvasWidth: number,
  canvasHeight: number,
  frameWidth: number,
  frameHeight: number,
): CanvasContentRect {
  const scale = Math.min(
    canvasWidth / Math.max(1, frameWidth),
    canvasHeight / Math.max(1, frameHeight),
  );
  const width = frameWidth * scale;
  const height = frameHeight * scale;
  return {
    canvasWidth,
    canvasHeight,
    x: (canvasWidth - width) / 2,
    y: (canvasHeight - height) / 2,
    width,
    height,
  };
}

/**
 * Map a point normalized to the page viewport onto the recorder canvas.
 * Identity while the frame fills the canvas (the common single-tab case);
 * compensates for letterbox bars after a switch to a differently sized tab.
 */
export function remapToCanvas(
  point: Point,
  rect: CanvasContentRect | undefined,
): Point {
  if (
    !rect ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.canvasWidth <= 0 ||
    rect.canvasHeight <= 0
  ) {
    return point;
  }
  return {
    x: clampUnit((rect.x + clampUnit(point.x) * rect.width) / rect.canvasWidth),
    y: clampUnit((rect.y + clampUnit(point.y) * rect.height) / rect.canvasHeight),
  };
}

/** Pages the recorder can attach to: plain http(s), excluding extension stores. */
export function isRecordableUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return ![
      "chrome.google.com",
      "chromewebstore.google.com",
      "microsoftedge.microsoft.com",
    ].includes(url.hostname);
  } catch {
    return false;
  }
}
