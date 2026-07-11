import {
  activeGradientColors,
  BACKGROUND_PRESETS,
  DEFAULT_GRADIENT,
  resolveBackground,
  sanitizeGradientColors,
} from "./background";

describe("frame background resolution", () => {
  it("maps presets to their gradient stops", () => {
    expect(resolveBackground({ background: "aurora", gradientColors: DEFAULT_GRADIENT }))
      .toEqual({ type: "gradient", colors: BACKGROUND_PRESETS.aurora });
  });

  it("uses the custom stops when the background is a user gradient", () => {
    const colors: [string, string, string] = ["#101010", "#202020", "#303030"];
    expect(resolveBackground({ background: "gradient", gradientColors: colors }))
      .toEqual({ type: "gradient", colors });
  });

  it("treats hex values as solid fills and rejects junk strings", () => {
    expect(resolveBackground({ background: "#18191f", gradientColors: DEFAULT_GRADIENT }))
      .toEqual({ type: "solid", color: "#18191f" });
    expect(resolveBackground({ background: "url(evil)", gradientColors: DEFAULT_GRADIENT }))
      .toEqual({ type: "solid", color: "#16171d" });
  });

  it("resolves none so the recording can bleed edge to edge", () => {
    expect(resolveBackground({ background: "none", gradientColors: DEFAULT_GRADIENT }))
      .toEqual({ type: "none" });
  });
});

describe("gradient stop sanitizing", () => {
  it("repairs malformed stops and expands shorthand hex", () => {
    expect(sanitizeGradientColors(["red", "#abc", 42])).toEqual([
      DEFAULT_GRADIENT[0],
      "#aabbcc",
      DEFAULT_GRADIENT[2],
    ]);
    expect(sanitizeGradientColors(undefined)).toEqual(DEFAULT_GRADIENT);
  });

  it("offers the active preset's stops for editing, falling back to stored stops", () => {
    expect(
      activeGradientColors({ background: "sunset", gradientColors: DEFAULT_GRADIENT }),
    ).toEqual(BACKGROUND_PRESETS.sunset);
    expect(
      activeGradientColors({ background: "#111111", gradientColors: ["#101010", "#202020", "#303030"] }),
    ).toEqual(["#101010", "#202020", "#303030"]);
  });
});
