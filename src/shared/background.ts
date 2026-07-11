import type { FrameSettings } from "./types";

export const DEFAULT_GRADIENT: [string, string, string] = [
  "#19152f",
  "#6948d9",
  "#23a9a1",
];

/** Canvas colors for the built-in background presets. */
export const BACKGROUND_PRESETS: Record<string, [string, string, string]> = {
  aurora: ["#19152f", "#6948d9", "#23a9a1"],
  midnight: ["#0a0b12", "#20243b", "#20243b"],
  sunset: ["#351b45", "#d05762", "#e8a45e"],
  ocean: ["#0c2537", "#176b87", "#35a6a0"],
};

const HEX_PATTERN = /^#[\da-f]{3,8}$/i;

export type BackgroundPaint =
  | { type: "none" }
  | { type: "solid"; color: string }
  | { type: "gradient"; colors: [string, string, string] };

/** Expand shorthand hex and strip alpha so values are safe for color inputs. */
function normalizeHex(color: unknown): string | null {
  if (typeof color !== "string") return null;
  const value = color.trim().toLowerCase();
  if (!HEX_PATTERN.test(value)) return null;
  const digits = value.slice(1);
  if (digits.length === 3 || digits.length === 4) {
    return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
  }
  return `#${digits.slice(0, 6)}`;
}

export function sanitizeGradientColors(value: unknown): [string, string, string] {
  const source = Array.isArray(value) ? value : [];
  return [
    normalizeHex(source[0]) ?? DEFAULT_GRADIENT[0],
    normalizeHex(source[1]) ?? DEFAULT_GRADIENT[1],
    normalizeHex(source[2]) ?? DEFAULT_GRADIENT[2],
  ];
}

/** True when the background is removed and the recording should bleed to the canvas edge. */
export function backgroundRemoved(frame: Pick<FrameSettings, "background">): boolean {
  return frame.background === "none";
}

/** Resolve the frame background setting into something the canvas can paint. */
export function resolveBackground(
  frame: Pick<FrameSettings, "background" | "gradientColors">,
): BackgroundPaint {
  if (backgroundRemoved(frame)) return { type: "none" };
  if (frame.background === "gradient") {
    return { type: "gradient", colors: sanitizeGradientColors(frame.gradientColors) };
  }
  const preset = BACKGROUND_PRESETS[frame.background];
  if (preset) return { type: "gradient", colors: [...preset] };
  const solid = normalizeHex(frame.background);
  return { type: "solid", color: solid ?? "#16171d" };
}

/**
 * Gradient stops the editor should offer for tweaking: the active preset's
 * colors when a preset is selected, otherwise the stored custom stops.
 */
export function activeGradientColors(
  frame: Pick<FrameSettings, "background" | "gradientColors">,
): [string, string, string] {
  const paint = resolveBackground(frame);
  return paint.type === "gradient"
    ? paint.colors
    : sanitizeGradientColors(frame.gradientColors);
}
