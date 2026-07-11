import { exportFilename, mp4TranscodeArguments } from "./exportFormat";

describe("export formats", () => {
  it("uses the selected extension with a safe project filename", () => {
    expect(exportFilename(" Product demo: final! ", "webm")).toBe(
      "product-demo-final.webm",
    );
    expect(exportFilename(" Product demo: final! ", "mp4")).toBe(
      "product-demo-final.mp4",
    );
  });

  it("transcodes MP4 with interoperable H.264 video and optional AAC audio", () => {
    const args = mp4TranscodeArguments("high");
    expect(args).toEqual(expect.arrayContaining([
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-threads",
      "1",
    ]));
    expect(args.slice(args.indexOf("-map"), args.indexOf("-c:v"))).toContain(
      "0:a:0?",
    );
    expect(args.at(-1)).toBe("/output.mp4");
  });

  it("uses a smaller bitrate and higher CRF for standard quality", () => {
    const standard = mp4TranscodeArguments("standard");
    const high = mp4TranscodeArguments("high");
    expect(standard[standard.indexOf("-crf") + 1]).toBe("23");
    expect(high[high.indexOf("-crf") + 1]).toBe("18");
    expect(standard[standard.indexOf("-b:a") + 1]).toBe("128k");
    expect(high[high.indexOf("-b:a") + 1]).toBe("192k");
  });
});

