import { containRect, isRecordableUrl, remapToCanvas } from "./capture";

describe("capture tab policy", () => {
  it("allows plain web pages and rejects privileged or store pages", () => {
    expect(isRecordableUrl("https://example.com/docs")).toBe(true);
    expect(isRecordableUrl("http://localhost:5173/")).toBe(true);
    expect(isRecordableUrl("chrome://extensions")).toBe(false);
    expect(isRecordableUrl("chrome-extension://abc/editor.html")).toBe(false);
    expect(isRecordableUrl("https://chromewebstore.google.com/detail/x")).toBe(false);
    expect(isRecordableUrl(undefined)).toBe(false);
    expect(isRecordableUrl("not a url")).toBe(false);
  });
});

describe("frame letterboxing math", () => {
  it("keeps same-size frames as an identity mapping", () => {
    const rect = containRect(1280, 720, 1280, 720);
    expect(rect).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
    expect(remapToCanvas({ x: 0.25, y: 0.75 }, rect)).toEqual({ x: 0.25, y: 0.75 });
  });

  it("centers a narrower frame and remaps pointer coordinates into it", () => {
    // A 640x720 (portrait-ish) tab drawn on a 1280x720 canvas: pillarboxed.
    const rect = containRect(1280, 720, 640, 720);
    expect(rect).toMatchObject({ x: 320, y: 0, width: 640, height: 720 });
    // Left edge of the page lands on the left edge of the content, not the bar.
    expect(remapToCanvas({ x: 0, y: 0.5 }, rect)).toEqual({ x: 0.25, y: 0.5 });
    expect(remapToCanvas({ x: 1, y: 1 }, rect)).toEqual({ x: 0.75, y: 1 });
  });

  it("falls back to the original point without a known content rect", () => {
    expect(remapToCanvas({ x: 0.4, y: 0.6 }, undefined)).toEqual({ x: 0.4, y: 0.6 });
  });
});
