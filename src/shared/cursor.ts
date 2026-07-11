import type { CursorKind } from "./types";

export const SCROLL_CURSOR_HIDE_MS = 180;

/**
 * Convert CSS cursor values to the small, stable set rendered by the editor.
 * Grab/all-scroll/resize cursors deliberately become the normal arrow so a
 * transient scroll affordance never appears in the finished recording.
 */
export function cursorKindFromCss(value: string): CursorKind {
  const cursor = value.trim().toLowerCase();
  if (cursor === "none") return "hidden";
  if (cursor === "pointer") return "pointer";
  if (cursor === "text" || cursor === "vertical-text") return "text";
  if (cursor === "crosshair" || cursor === "cell") return "crosshair";
  return "default";
}

export function shouldShowRecordedCursor({
  documentVisible,
  pointerInside,
  scrolling,
}: {
  documentVisible: boolean;
  pointerInside: boolean;
  scrolling: boolean;
}) {
  return documentVisible && pointerInside && !scrolling;
}
