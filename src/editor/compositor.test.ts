import { createProject } from "../shared/project";
import { canvasPointToSource, getFrameComposition } from "./compositor";

const project = createProject({
  id: "composition",
  title: "Composition",
  sourceUrl: "https://example.com",
  duration: 5_000,
  sourceWidth: 1280,
  sourceHeight: 720,
  mimeType: "video/webm",
  events: [
    { type: "pointer", t: 0, x: 0.5, y: 0.5, cursor: "default" },
    { type: "click", t: 1_000, x: 0.5, y: 0.5, button: 0 },
  ],
});

describe("frame composition", () => {
  it("uses the current decoded media dimensions after a tab resize", () => {
    const composition = getFrameComposition(project, 0, 1000, 1000, 900, 1600);

    expect(composition.sourceWidth).toBe(900);
    expect(composition.sourceHeight).toBe(1600);
    expect(composition.crop).toMatchObject({ x: 0, y: 0, width: 900, height: 1600 });
    expect(composition.frame.width / composition.frame.height).toBeCloseTo(9 / 16);

    const center = canvasPointToSource(
      {
        x: composition.frame.x + composition.frame.width / 2,
        y: composition.frame.y + composition.frame.height / 2,
      },
      composition,
      project,
    );
    expect(center).toEqual({ x: 0.5, y: 0.5 });
  });

  it("lets the recording bleed edge to edge when the background is removed", () => {
    const removed = {
      ...project,
      frame: { ...project.frame, background: "none" },
    };

    const composition = getFrameComposition(removed, 0, 1280, 720);
    expect(composition.frame).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  });

  it("removes the synthetic cursor throughout a hidden timeline range", () => {
    const hidden = {
      ...project,
      hiddenCursorRanges: [{ id: "hidden", start: 900, end: 1_400 }],
    };

    expect(getFrameComposition(hidden, 1_000, 1280, 720).cursor).toBeNull();
  });
});
