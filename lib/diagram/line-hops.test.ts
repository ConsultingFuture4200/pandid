// Line-jump (hop) geometry tests — DEV-1208.

import { describe, expect, it } from "vitest";
import {
  hopPathData,
  verticalSegments,
  type Point,
  type VerticalSegment,
} from "./line-hops";

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

describe("verticalSegments", () => {
  it("extracts vertical runs and ignores horizontal / zero-length ones", () => {
    const route: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 100 }, // vertical
      { x: 50, y: 100 }, // horizontal
      { x: 50, y: 100 }, // zero-length
      { x: 50, y: 40 }, // vertical
    ];
    expect(verticalSegments(route)).toEqual([
      { x: 0, y1: 0, y2: 100 },
      { x: 50, y1: 40, y2: 100 },
    ]);
  });
});

describe("hopPathData", () => {
  // A horizontal line at y=50 from x=0 to x=100.
  const horizontal: Point[] = [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ];

  it("returns null when the route crosses nothing", () => {
    expect(hopPathData(horizontal, [], fmt)).toBeNull();
    // A vertical that does not reach the line's height → no crossing.
    const farBelow: VerticalSegment[] = [{ x: 50, y1: 80, y2: 120 }];
    expect(hopPathData(horizontal, farBelow, fmt)).toBeNull();
  });

  it("adds an upward hop arc at a strict-interior crossing", () => {
    const crossing: VerticalSegment[] = [{ x: 50, y1: 0, y2: 100 }];
    const d = hopPathData(horizontal, crossing, fmt);
    expect(d).not.toBeNull();
    // Travels into the hop, arcs over (radius 6, sweep 1 going right), resumes.
    expect(d).toBe("M 0 50 L 44 50 A 6 6 0 0 1 56 50 L 100 50");
  });

  it("does not hop at a shared endpoint (tee junction)", () => {
    // Vertical whose top sits exactly on the line → they meet, not cross.
    const tee: VerticalSegment[] = [{ x: 50, y1: 50, y2: 150 }];
    expect(hopPathData(horizontal, tee, fmt)).toBeNull();
    // Vertical at the horizontal's own endpoint x → endpoint, not interior.
    const atEnd: VerticalSegment[] = [{ x: 0, y1: 0, y2: 100 }];
    expect(hopPathData(horizontal, atEnd, fmt)).toBeNull();
  });

  it("orders multiple hops along travel direction (right-to-left)", () => {
    const leftward: Point[] = [
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ];
    const crossings: VerticalSegment[] = [
      { x: 30, y1: 0, y2: 100 },
      { x: 70, y1: 0, y2: 100 },
    ];
    const d = hopPathData(leftward, crossings, fmt);
    // First hop is the rightmost (x=70), then x=30; going left → sweep 0.
    expect(d).toBe(
      "M 100 50 L 76 50 A 6 6 0 0 0 64 50 L 36 50 A 6 6 0 0 0 24 50 L 0 50",
    );
  });
});
