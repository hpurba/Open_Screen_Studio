import { cursorKindFromCss, shouldShowRecordedCursor } from "./cursor";

describe("cursor capture policy", () => {
  it("keeps semantic cursors that help viewers follow an interaction", () => {
    expect(cursorKindFromCss("pointer")).toBe("pointer");
    expect(cursorKindFromCss("text")).toBe("text");
    expect(cursorKindFromCss("crosshair")).toBe("crosshair");
    expect(cursorKindFromCss("none")).toBe("hidden");
  });

  it("normalizes grab and scroll affordances to the regular arrow", () => {
    for (const cursor of [
      "grab",
      "grabbing",
      "all-scroll",
      "ns-resize",
      "row-resize",
      "col-resize",
    ]) {
      expect(cursorKindFromCss(cursor)).toBe("default");
    }
  });

  it("suppresses only the recorded cursor while a scroll is active", () => {
    expect(
      shouldShowRecordedCursor({
        documentVisible: true,
        pointerInside: true,
        scrolling: false,
      }),
    ).toBe(true);
    expect(
      shouldShowRecordedCursor({
        documentVisible: true,
        pointerInside: true,
        scrolling: true,
      }),
    ).toBe(false);
  });
});
