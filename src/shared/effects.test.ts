import { describe, expect, it, vi } from "vitest";

import {
  cameraStateAt,
  cameraStateForEventsAt,
  clamp,
  cursorKindAt,
  cursorOpacityAt,
  cursorPositionAt,
  cursorStateAt,
  generateAutoZooms,
  hiddenRangeOpacityAt,
  idleOpacityAt,
  recordedVisibilityOpacityAt,
  smoothstep,
  zoomStateAt,
} from "./effects";
import type {
  CameraSettings,
  CaptureEvent,
  ClickSample,
  CursorSettings,
  HiddenCursorRange,
  Point,
  PointerSample,
  ZoomSegment,
} from "./types";

const cursorSettings: CursorSettings = {
  visible: true,
  size: 1,
  smoothing: 0.7,
  hideWhenIdle: true,
  idleDelay: 1_000,
  clickRipple: true,
};

const cameraSettings: CameraSettings = {
  autoZoom: true,
  defaultScale: 1,
  transitionMs: 200,
  followStrength: 1,
  deadZone: 0.2,
};

const pointer = (
  t: number,
  x: number,
  y: number,
  cursor: "default" | "pointer" | "text" = "default",
): PointerSample => ({ type: "pointer", t, x, y, cursor });

const click = (t: number, x: number, y: number): ClickSample => ({
  type: "click",
  t,
  x,
  y,
  button: 0,
});

const zoom = (overrides: Partial<ZoomSegment> = {}): ZoomSegment => ({
  id: "zoom-1",
  kind: "manual",
  start: 100,
  end: 1_100,
  scale: 2,
  target: { x: 0.5, y: 0.5 },
  follow: false,
  ...overrides,
});

describe("numeric helpers", () => {
  it("clamps normal, reversed, and non-finite input", () => {
    expect(clamp(-2)).toBe(0);
    expect(clamp(2)).toBe(1);
    expect(clamp(5, 10, 0)).toBe(5);
    expect(clamp(Number.NaN, 3, 8)).toBe(3);
    expect(clamp(Number.POSITIVE_INFINITY, 3, 8)).toBe(3);
  });

  it("smoothstep is bounded and supports explicit edges", () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(10, 20, 15)).toBeCloseTo(0.5);
    expect(smoothstep(1, 1, 0)).toBe(0);
    expect(smoothstep(1, 1, 1)).toBe(1);
    expect(smoothstep(Number.NaN)).toBe(0);
  });
});

describe("cursor interpolation and smoothing", () => {
  it("linearly interpolates normalized pointer samples", () => {
    const events = [pointer(0, 0.1, 0.2), pointer(1_000, 0.9, 0.6)];
    expect(cursorPositionAt(events, 500, 0)).toEqual({ x: 0.5, y: 0.4 });
    expect(cursorPositionAt(events, -100, 0)).toEqual({ x: 0.1, y: 0.2 });
    expect(cursorPositionAt(events, 5_000, 0)).toEqual({ x: 0.9, y: 0.6 });
  });

  it("uses a centered kernel without lag on constant-velocity motion", () => {
    const events = [
      pointer(0, 0, 0.5),
      pointer(500, 0.5, 0.5),
      pointer(1_000, 1, 0.5),
    ];
    const smoothed = cursorPositionAt(events, 500, 1);
    expect(smoothed.x).toBeCloseTo(0.5, 6);
    expect(smoothed.y).toBeCloseTo(0.5, 6);
  });

  it("softens a sharp pointer spike", () => {
    const events = [
      pointer(0, 0, 0.5),
      pointer(100, 1, 0.5),
      pointer(200, 0, 0.5),
    ];
    expect(cursorPositionAt(events, 100, 1).x).toBeLessThan(0.8);
    expect(cursorPositionAt(events, 100, 1).x).toBeGreaterThan(0);
  });

  it("anchors the smoothed cursor exactly at every click", () => {
    const events = [
      pointer(0, 0.1, 0.1),
      pointer(400, 0.4, 0.4),
      click(500, 0.83, 0.17),
      pointer(600, 0.6, 0.6),
      click(800, 0.22, 0.91),
      pointer(1_000, 0.9, 0.9),
    ];
    expect(cursorPositionAt(events, 500, 1)).toEqual({ x: 0.83, y: 0.17 });
    expect(cursorPositionAt(events, 800, 1)).toEqual({ x: 0.22, y: 0.91 });
  });

  it("lets a click win when pointer telemetry shares its timestamp", () => {
    const events = [
      pointer(0, 0, 0),
      click(500, 0.8, 0.2),
      pointer(500, 0.4, 0.4),
      pointer(1_000, 1, 1),
    ];
    expect(cursorPositionAt(events, 500, 1)).toEqual({ x: 0.8, y: 0.2 });
  });

  it("normalizes malformed and out-of-bounds telemetry", () => {
    const malformed = [
      pointer(0, -5, 10),
      pointer(100, Number.NaN, 0.4),
      click(200, 2, -1),
    ];

    for (const time of [Number.NaN, -1, 0, 50, 200, Number.POSITIVE_INFINITY]) {
      const result = cursorPositionAt(malformed, time, 99);
      expect(Number.isFinite(result.x)).toBe(true);
      expect(Number.isFinite(result.y)).toBe(true);
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.x).toBeLessThanOrEqual(1);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeLessThanOrEqual(1);
    }
  });

  it("returns a stable center without position telemetry", () => {
    expect(cursorPositionAt([], 10_000, 1)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("compiles an immutable event array once for repeated frame evaluation", () => {
    const source: CaptureEvent[] = [];
    for (let index = 0; index < 2_048; index += 1) {
      source.push(
        pointer(
          index * 16,
          (index % 400) / 400,
          ((index * 7) % 400) / 400,
          index % 3 === 0 ? "pointer" : "default",
        ),
      );
      if (index % 256 === 128) {
        source.push(click(index * 16 + 1, 0.25, 0.75));
      }
    }

    let sourceReads = 0;
    const events = new Proxy(source, {
      get(target, property, receiver) {
        sourceReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const ranges: HiddenCursorRange[] = [
      { id: "cached-range", start: 5_000, end: 5_500 },
    ];
    const zooms = [zoom({ instant: true, follow: true })];

    // Warm all event-, range-, smoothing-, and zoom-dependent caches.
    cursorStateAt(events, ranges, 4_000, cursorSettings);
    cameraStateForEventsAt(
      zooms,
      events,
      4_000,
      cameraSettings,
      cursorSettings.smoothing,
    );
    expect(sourceReads).toBeGreaterThan(0);

    sourceReads = 0;
    const sortSpy = vi.spyOn(Array.prototype, "sort");
    const filterSpy = vi.spyOn(Array.prototype, "filter");
    for (let frame = 0; frame < 64; frame += 1) {
      const time = 4_000 + frame * 16;
      cursorStateAt(events, ranges, time, cursorSettings);
      cameraStateForEventsAt(
        zooms,
        events,
        time,
        cameraSettings,
        cursorSettings.smoothing,
      );
    }
    const sortCalls = sortSpy.mock.calls.length;
    const filterCalls = filterSpy.mock.calls.length;
    sortSpy.mockRestore();
    filterSpy.mockRestore();

    expect(sourceReads).toBe(0);
    expect(sortCalls).toBe(0);
    expect(filterCalls).toBe(0);
  });
});

describe("cursor kind and opacity", () => {
  it("samples the latest cursor kind in timestamp order", () => {
    const events = [
      pointer(500, 0.5, 0.5, "text"),
      pointer(100, 0.1, 0.1, "pointer"),
      pointer(800, 0.8, 0.8, "default"),
    ];
    expect(cursorKindAt(events, 50)).toBe("default");
    expect(cursorKindAt(events, 100)).toBe("pointer");
    expect(cursorKindAt(events, 700)).toBe("text");
    expect(cursorKindAt(events, 900)).toBe("default");
  });

  it("eases recorded visibility changes and handles interrupted fades", () => {
    const events: CaptureEvent[] = [
      { type: "visibility", t: 100, visible: false },
      { type: "visibility", t: 150, visible: true },
    ];
    expect(recordedVisibilityOpacityAt(events, 99, 100)).toBe(1);
    expect(recordedVisibilityOpacityAt(events, 125, 100)).toBeLessThan(1);
    const atInterruption = recordedVisibilityOpacityAt(events, 150, 100);
    expect(atInterruption).toBeGreaterThan(0);
    expect(atInterruption).toBeLessThan(1);
    expect(recordedVisibilityOpacityAt(events, 250, 100)).toBe(1);
    expect(recordedVisibilityOpacityAt(events, 100, 0)).toBe(0);
  });

  it("fades only after the idle delay", () => {
    const events = [pointer(0, 0, 0), pointer(500, 0.5, 0.5)];
    expect(idleOpacityAt(events, 1_500, 1_000, 200)).toBe(1);
    expect(idleOpacityAt(events, 1_600, 1_000, 200)).toBeCloseTo(0.5);
    expect(idleOpacityAt(events, 1_700, 1_000, 200)).toBe(0);
  });

  it("does not treat duplicate stationary samples as movement", () => {
    const events = [pointer(0, 0.5, 0.5), pointer(2_000, 0.5, 0.5)];
    expect(idleOpacityAt(events, 2_000, 1_000, 100)).toBe(0);
  });

  it("treats clicks as activity even without movement", () => {
    const events = [pointer(0, 0.5, 0.5), click(2_000, 0.5, 0.5)];
    expect(idleOpacityAt(events, 2_500, 1_000, 100)).toBe(1);
  });

  it("hides fully inside edit ranges and eases outside their boundaries", () => {
    const ranges: HiddenCursorRange[] = [{ id: "hide", start: 1_000, end: 2_000 }];
    expect(hiddenRangeOpacityAt(ranges, 800, 100)).toBe(1);
    expect(hiddenRangeOpacityAt(ranges, 950, 100)).toBeCloseTo(0.5);
    expect(hiddenRangeOpacityAt(ranges, 1_000, 100)).toBe(0);
    expect(hiddenRangeOpacityAt(ranges, 1_500, 100)).toBe(0);
    expect(hiddenRangeOpacityAt(ranges, 2_000, 100)).toBe(0);
    expect(hiddenRangeOpacityAt(ranges, 2_050, 100)).toBeCloseTo(0.5);
    expect(hiddenRangeOpacityAt(ranges, 2_100, 100)).toBe(1);
  });

  it("merges overlapping and reversed hidden ranges", () => {
    const ranges: HiddenCursorRange[] = [
      { id: "a", start: 2_000, end: 1_000 },
      { id: "b", start: 1_800, end: 3_000 },
    ];
    expect(hiddenRangeOpacityAt(ranges, 2_500, 100)).toBe(0);
    expect(hiddenRangeOpacityAt(ranges, 3_050, 100)).toBeCloseTo(0.5);
  });

  it("composes global, recorded, idle, hidden-range, and cursor-kind visibility", () => {
    const events: CaptureEvent[] = [
      pointer(0, 0.1, 0.1),
      { type: "visibility", t: 500, visible: false },
    ];
    expect(cursorOpacityAt(events, [], 700, cursorSettings, 100)).toBe(0);
    expect(
      cursorOpacityAt(events, [], 0, { ...cursorSettings, visible: false }),
    ).toBe(0);
    expect(
      cursorOpacityAt(
        [pointer(0, 0, 0), { ...pointer(100, 1, 1), cursor: "hidden" }],
        [],
        100,
        cursorSettings,
      ),
    ).toBe(0);
    expect(cursorOpacityAt([], [], 0, cursorSettings)).toBe(0);
  });

  it("returns one coherent cursor frame state", () => {
    const state = cursorStateAt(
      [pointer(0, 0.25, 0.75, "pointer")],
      [],
      0,
      { ...cursorSettings, hideWhenIdle: false },
    );
    expect(state).toEqual({
      position: { x: 0.25, y: 0.75 },
      kind: "pointer",
      opacity: 1,
      visible: true,
    });
  });
});

describe("automatic zoom generation", () => {
  it("returns no automatic ranges when disabled or unusable", () => {
    expect(generateAutoZooms([click(500, 0.5, 0.5)], 1_000, { autoZoom: false })).toEqual([]);
    expect(generateAutoZooms([], 1_000)).toEqual([]);
    expect(generateAutoZooms([click(0, 0.5, 0.5)], Number.NaN)).toEqual([]);
  });

  it("creates a bounded automatic range around a click", () => {
    const [result] = generateAutoZooms([click(100, -2, 4)], 1_000);
    expect(result.kind).toBe("auto");
    expect(result.start).toBe(0);
    expect(result.end).toBe(1_000);
    expect(result.target).toEqual({ x: 0, y: 1 });
    expect(result.scale).toBeGreaterThan(1);
    expect(result.follow).toBe(true);
  });

  it("merges nearby click ranges and averages their targets", () => {
    const results = generateAutoZooms(
      [click(1_000, 0.2, 0.4), click(2_500, 0.8, 0.6)],
      10_000,
    );
    expect(results).toHaveLength(1);
    expect(results[0].start).toBe(720);
    expect(results[0].end).toBe(3_950);
    expect(results[0].target.x).toBeCloseTo(0.5);
    expect(results[0].target.y).toBeCloseTo(0.5);
  });

  it("keeps distant click groups separate and deterministic", () => {
    const events = [click(5_000, 0.8, 0.8), click(500, 0.2, 0.2)];
    const first = generateAutoZooms(events, 8_000);
    const second = generateAutoZooms(events, 8_000);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first.map((item) => item.id)).toEqual(["auto-0-500", "auto-1-5000"]);
  });

  it("ignores non-finite and out-of-duration clicks", () => {
    const events = [
      click(-1, 0.5, 0.5),
      click(2_000, 0.5, 0.5),
      click(Number.NaN, 0.5, 0.5),
    ];
    expect(generateAutoZooms(events, 1_000)).toEqual([]);
  });
});

describe("zoom and camera state", () => {
  it("returns the configured default outside zoom ranges", () => {
    expect(zoomStateAt([zoom()], 0, { defaultScale: 1.1 })).toEqual({
      scale: 1.1,
      target: { x: 0.5, y: 0.5 },
      follow: false,
      progress: 0,
      segmentId: null,
    });
  });

  it("smoothly eases into and out of a zoom", () => {
    const segment = zoom();
    expect(zoomStateAt([segment], 100, cameraSettings).scale).toBe(1);
    expect(zoomStateAt([segment], 200, cameraSettings).scale).toBeCloseTo(1.5);
    expect(zoomStateAt([segment], 300, cameraSettings).scale).toBe(2);
    expect(zoomStateAt([segment], 1_000, cameraSettings).scale).toBeCloseTo(1.5);
    expect(zoomStateAt([segment], 1_100, cameraSettings).scale).toBe(1);
  });

  it("supports instant zooms", () => {
    const state = zoomStateAt([zoom({ instant: true })], 100, cameraSettings);
    expect(state.scale).toBe(2);
    expect(state.progress).toBe(1);
    expect(state.segmentId).toBe("zoom-1");
  });

  it("gives overlapping manual zooms priority over automatic zooms", () => {
    const automatic = zoom({
      id: "auto",
      kind: "auto",
      target: { x: 0.1, y: 0.1 },
      instant: true,
    });
    const manual = zoom({
      id: "manual",
      kind: "manual",
      target: { x: 0.9, y: 0.9 },
      instant: true,
    });
    expect(zoomStateAt([manual, automatic], 500, cameraSettings).segmentId).toBe(
      "manual",
    );
  });

  it("layers a manual transition over an active automatic zoom", () => {
    const automatic = zoom({
      id: "auto",
      kind: "auto",
      start: 0,
      end: 2_000,
      scale: 2,
      target: { x: 0.2, y: 0.2 },
      follow: true,
      instant: true,
    });
    const manual = zoom({
      id: "manual",
      kind: "manual",
      start: 500,
      end: 1_500,
      scale: 3,
      target: { x: 0.8, y: 0.8 },
      follow: false,
    });

    const before = zoomStateAt([automatic, manual], 500, cameraSettings);
    const justInside = zoomStateAt([automatic, manual], 501, cameraSettings);
    const halfway = zoomStateAt([automatic, manual], 600, cameraSettings);
    const fullyManual = zoomStateAt([automatic, manual], 700, cameraSettings);

    expect(before.scale).toBe(2);
    expect(before.target).toEqual({ x: 0.2, y: 0.2 });
    expect(justInside.segmentId).toBe("manual");
    expect(justInside.scale).toBeGreaterThan(2);
    expect(justInside.scale).toBeLessThan(2.001);
    expect(justInside.target.x).toBeCloseTo(0.2, 3);
    expect(halfway.scale).toBeCloseTo(2.5);
    expect(halfway.target).toEqual({ x: 0.5, y: 0.5 });
    expect(fullyManual.scale).toBe(3);
    expect(fullyManual.target).toEqual({ x: 0.8, y: 0.8 });
    expect(fullyManual.follow).toBe(false);
  });

  it("reveals the underlying automatic zoom while a manual layer exits", () => {
    const automatic = zoom({
      id: "auto",
      kind: "auto",
      start: 0,
      end: 2_000,
      scale: 2,
      target: { x: 0.2, y: 0.2 },
      instant: true,
    });
    const manual = zoom({
      id: "manual",
      start: 500,
      end: 1_500,
      scale: 3,
      target: { x: 0.8, y: 0.8 },
    });

    const justBeforeEnd = zoomStateAt(
      [automatic, manual],
      1_499,
      cameraSettings,
    );
    const atEnd = zoomStateAt(
      [automatic, manual],
      1_500,
      cameraSettings,
    );
    expect(justBeforeEnd.scale).toBeGreaterThan(2);
    expect(justBeforeEnd.scale).toBeLessThan(2.001);
    expect(justBeforeEnd.target.x).toBeCloseTo(0.2, 3);
    expect(atEnd.scale).toBe(2);
    expect(atEnd.target).toEqual({ x: 0.2, y: 0.2 });
    expect(atEnd.segmentId).toBe("auto");
  });

  it("blends cursor-follow influence across manual-over-auto transitions", () => {
    const automatic = zoom({
      id: "auto-follow",
      kind: "auto",
      start: 0,
      end: 2_000,
      scale: 4,
      target: { x: 0.5, y: 0.5 },
      follow: true,
      instant: true,
    });
    const manual = zoom({
      id: "manual-static",
      start: 500,
      end: 1_500,
      scale: 4,
      target: { x: 0.5, y: 0.5 },
      follow: false,
    });
    const settings = {
      ...cameraSettings,
      deadZone: 0,
      followStrength: 1,
    };

    const before = cameraStateAt(
      [automatic, manual],
      500,
      { x: 1, y: 0.5 },
      settings,
    );
    const halfway = cameraStateAt(
      [automatic, manual],
      600,
      { x: 1, y: 0.5 },
      settings,
    );
    const fullyManual = cameraStateAt(
      [automatic, manual],
      700,
      { x: 1, y: 0.5 },
      settings,
    );

    expect(before.center.x).toBe(0.875);
    expect(halfway.center.x).toBeCloseTo(0.75);
    expect(fullyManual.center.x).toBe(0.5);
  });

  it("layers later manual transitions over earlier manual zooms", () => {
    const earlier = zoom({
      id: "earlier",
      start: 100,
      end: 1_900,
      scale: 2.5,
      target: { x: 0.3, y: 0.3 },
      instant: true,
    });
    const later = zoom({
      id: "later",
      start: 500,
      end: 1_500,
      scale: 4,
      target: { x: 0.9, y: 0.9 },
    });

    expect(zoomStateAt([later, earlier], 500, cameraSettings).scale).toBe(2.5);
    const justInside = zoomStateAt([later, earlier], 501, cameraSettings);
    expect(justInside.segmentId).toBe("later");
    expect(justInside.scale).toBeGreaterThan(2.5);
    expect(justInside.scale).toBeLessThan(2.501);
  });

  it("honors autoZoom when callers pass the unfiltered zoom list", () => {
    const automatic = zoom({
      id: "auto",
      kind: "auto",
      instant: true,
    });
    expect(
      zoomStateAt([automatic], 500, {
        ...cameraSettings,
        autoZoom: false,
      }),
    ).toEqual({
      scale: 1,
      target: { x: 0.5, y: 0.5 },
      follow: false,
      progress: 0,
      segmentId: null,
    });
  });

  it("keeps the camera still while the cursor remains in the dead zone", () => {
    const state = cameraStateAt(
      [zoom({ instant: true, follow: true })],
      500,
      { x: 0.54, y: 0.46 },
      { ...cameraSettings, deadZone: 0.4 },
    );
    expect(state.center).toEqual({ x: 0.5, y: 0.5 });
    expect(state.source).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  it("follows beyond the dead zone and clamps to source bounds", () => {
    const state = cameraStateAt(
      [zoom({ instant: true, follow: true })],
      500,
      { x: 0.95, y: 0.05 },
      { ...cameraSettings, deadZone: 0.2 },
    );
    expect(state.center).toEqual({ x: 0.75, y: 0.25 });
    expect(state.source).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });

  it("does not follow when the active segment opts out", () => {
    const state = cameraStateAt(
      [zoom({ instant: true, follow: false, target: { x: 0.4, y: 0.6 } })],
      500,
      { x: 1, y: 0 },
      cameraSettings,
    );
    expect(state.center).toEqual({ x: 0.4, y: 0.6 });
  });

  it("clamps a target near the edge to a valid normalized source rectangle", () => {
    const state = cameraStateAt(
      [zoom({ instant: true, scale: 4, target: { x: 0, y: 1 } })],
      500,
      null,
      cameraSettings,
    );
    expect(state.center).toEqual({ x: 0.125, y: 0.875 });
    expect(state.source).toEqual({ x: 0, y: 0.75, width: 0.25, height: 0.25 });
  });

  it("can derive the followed camera directly from capture events", () => {
    const state = cameraStateForEventsAt(
      [zoom({ instant: true, follow: true })],
      [pointer(0, 0.5, 0.5), pointer(500, 1, 1)],
      500,
      cameraSettings,
    );
    expect(state.center).toEqual({ x: 0.75, y: 0.75 });
  });

  it("always emits finite normalized cursor and camera output", () => {
    const malformedZoom = zoom({
      start: -100,
      end: 2_000,
      scale: Number.POSITIVE_INFINITY,
      target: { x: Number.NaN, y: -100 },
      instant: true,
      follow: true,
    });
    const malformedCursor: Point = { x: Number.NaN, y: Number.POSITIVE_INFINITY };

    for (const time of [Number.NaN, -100, 0, 500, 10_000]) {
      const cursor = cursorPositionAt([pointer(0, -2, 3)], time, 1);
      const camera = cameraStateAt(
        [malformedZoom],
        time,
        malformedCursor,
        {
          defaultScale: Number.NaN,
          transitionMs: Number.NaN,
          followStrength: Number.POSITIVE_INFINITY,
          deadZone: Number.NaN,
        },
      );

      for (const value of [
        cursor.x,
        cursor.y,
        camera.scale,
        camera.center.x,
        camera.center.y,
        camera.source.x,
        camera.source.y,
        camera.source.width,
        camera.source.height,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(cursor.x).toBeGreaterThanOrEqual(0);
      expect(cursor.x).toBeLessThanOrEqual(1);
      expect(cursor.y).toBeGreaterThanOrEqual(0);
      expect(cursor.y).toBeLessThanOrEqual(1);
      expect(camera.source.x).toBeGreaterThanOrEqual(0);
      expect(camera.source.y).toBeGreaterThanOrEqual(0);
      expect(camera.source.x + camera.source.width).toBeLessThanOrEqual(1);
      expect(camera.source.y + camera.source.height).toBeLessThanOrEqual(1);
    }
  });
});
