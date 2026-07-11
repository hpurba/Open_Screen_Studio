import type { Point, Project } from "../shared/types";

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

export const smoothstep = (value: number) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const formatDuration = (milliseconds: number, precise = false) => {
  if (!Number.isFinite(milliseconds)) return "0:00";
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const base = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  return precise ? `${base}.${Math.floor((totalSeconds % 1) * 10)}` : base;
};

export const formatDate = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat(undefined, options).format(date);
};

export const safeHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "Local recording";
  }
};

export const nearestCursorPoint = (project: Project, time: number): Point => {
  let closest: Point | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const event of project.events) {
    if (event.type !== "pointer") continue;
    const nextDistance = Math.abs(event.t - time);
    if (nextDistance < distance) {
      closest = { x: event.x, y: event.y };
      distance = nextDistance;
    }
  }
  return closest ?? { x: 0.5, y: 0.5 };
};

export const even = (value: number) => {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
};

export const outputSize = (project: Project) => {
  const edge = project.export.width;
  switch (project.frame.aspectRatio) {
    case "16:9":
      return { width: even(edge), height: even((edge * 9) / 16) };
    case "9:16":
      return { width: even((edge * 9) / 16), height: even(edge) };
    case "1:1":
      return { width: even(edge), height: even(edge) };
    default: {
      const sourceWidth = Math.max(1, project.sourceWidth);
      const sourceHeight = Math.max(1, project.sourceHeight);
      const ratio = sourceWidth / sourceHeight;
      if (ratio >= 1) return { width: even(edge), height: even(edge / ratio) };
      return { width: even(edge * ratio), height: even(edge) };
    }
  }
};
