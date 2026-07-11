import { createProject, normalizeProject, safeProjectFilename } from "./project";

describe("project model", () => {
  it("creates a complete editable project with safe defaults", () => {
    const project = createProject({
      id: "one",
      title: "Demo",
      sourceUrl: "https://example.com",
      duration: 2400,
      sourceWidth: 1440,
      sourceHeight: 900,
      mimeType: "video/webm",
      events: [],
    });

    expect(project.trimEnd).toBe(2400);
    expect(project.hiddenCursorRanges).toEqual([]);
    expect(project.cursor.smoothing).toBeGreaterThan(0);
    expect(project.camera.autoZoom).toBe(true);
    expect(project.export.width).toBe(1920);
  });

  it("normalizes ranges and backfills missing editor collections", () => {
    const base = createProject({
      id: "one",
      title: "Demo",
      sourceUrl: "",
      duration: 1000,
      sourceWidth: 100,
      sourceHeight: 100,
      mimeType: "video/webm",
      events: [],
    });
    const normalized = normalizeProject({
      ...base,
      trimStart: -20,
      trimEnd: 5000,
      hiddenCursorRanges: undefined as never,
    });

    expect(normalized.trimStart).toBe(0);
    expect(normalized.trimEnd).toBe(1000);
    expect(normalized.hiddenCursorRanges).toEqual([]);
  });

  it("makes safe deterministic export names", () => {
    expect(safeProjectFilename("  Product demo: July / final! ")).toBe(
      "product-demo-july-final",
    );
    expect(safeProjectFilename("🔥")).toBe("open-screen-recording");
  });
});
