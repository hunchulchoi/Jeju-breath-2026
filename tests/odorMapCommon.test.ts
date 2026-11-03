import { describe, expect, it } from "vitest";
import { markerZ, overflowPan, popupMaxSize, Z_REPORT_BASE } from "@/app/components/odorMapCommon";

const map = { left: 0, top: 0, right: 400, bottom: 300 };
const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("overflowPan", () => {
  it("fully inside: no pan", () => {
    expect(overflowPan(box(50, 50, 300, 200), map, 12)).toEqual({ dx: 0, dy: 0 });
  });
  it("top overflow moves center up (negative dy)", () => {
    expect(overflowPan(box(50, -20, 300, 100), map, 12)).toEqual({ dx: 0, dy: -32 });
  });
  it("right overflow moves center right, left overflow left", () => {
    expect(overflowPan(box(200, 50, 430, 100), map, 12)).toEqual({ dx: 42, dy: 0 });
    expect(overflowPan(box(-30, 50, 120, 100), map, 12)).toEqual({ dx: -42, dy: 0 });
  });
  it("bottom overflow moves center down", () => {
    expect(overflowPan(box(50, 200, 300, 310), map, 12)).toEqual({ dx: 0, dy: 22 });
  });
  it("corner overflow handles both axes", () => {
    expect(overflowPan(box(300, -5, 420, 100), map, 0)).toEqual({ dx: 20, dy: -5 });
  });
  it("popup larger than map: keeps top/left edge visible", () => {
    const r = overflowPan(box(10, 20, 500, 400), map, 12);
    expect(r.dx).toBe(0 + Math.min(500 - 388, 10 - 12));
    expect(r.dy).toBe(Math.min(400 - 288, 20 - 12));
  });
});

describe("popupMaxSize", () => {
  it("fits width within map minus margins", () => {
    expect(popupMaxSize(360, 600, 20, 12, 800).maxWidth).toBe(336);
  });
  it("small map (40vh) limits height below 45vh", () => {
    const { maxHeight } = popupMaxSize(360, 280, 20, 12, 700);
    expect(maxHeight).toBe(280 - 24 - 20);
  });
  it("tall map capped at 45vh", () => {
    expect(popupMaxSize(360, 900, 20, 12, 700).maxHeight).toBe(315);
  });
});

describe("markerZ", () => {
  it("needs-review always below normal, even with higher index", () => {
    expect(markerZ(5, true)).toBeLessThan(markerZ(0, false));
    expect(markerZ(10_000, true)).toBeLessThan(markerZ(0, false));
  });
  it("keeps group order within a tier", () => {
    expect(markerZ(1, false)).toBeLessThan(markerZ(2, false));
    expect(markerZ(0, true)).toBeLessThan(markerZ(1, true));
  });
  it("stays above me (5) and below popup (1000)", () => {
    expect(markerZ(0, true)).toBeGreaterThanOrEqual(Z_REPORT_BASE);
    expect(markerZ(10_000, false)).toBeLessThan(1000);
  });
});
