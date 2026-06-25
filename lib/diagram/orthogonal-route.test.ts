// routeConnectionPoints — auto-route vs explicit waypoints (DEV-1210).

import { describe, expect, it } from "vitest";
import { routeConnectionPoints, type BodyBox } from "./orthogonal-route";

const box = (cx: number, cy: number): BodyBox => ({ cx, cy, hx: 20, hy: 20 });

describe("routeConnectionPoints", () => {
  it("auto-routes orthogonally between two boxes when no waypoints given", () => {
    const start = { x: 100, y: 50 };
    const end = { x: 300, y: 90 };
    const route = routeConnectionPoints(start, box(80, 50), end, box(320, 90));
    // Right-angle route: starts at start, ends at end, every segment axis-aligned.
    expect(route[0]).toEqual(start);
    expect(route[route.length - 1]).toEqual(end);
    for (let i = 1; i < route.length; i += 1) {
      const dx = route[i].x - route[i - 1].x;
      const dy = route[i].y - route[i - 1].y;
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });

  it("passes through explicit waypoints, ignoring the auto-router", () => {
    const start = { x: 1170, y: 1000 };
    const end = { x: 170, y: 205 };
    const waypoints = [
      { x: 1170, y: 1260 },
      { x: 170, y: 1260 },
    ];
    const route = routeConnectionPoints(
      start,
      box(1170, 980),
      end,
      box(170, 170),
      waypoints,
    );
    expect(route).toEqual([start, ...waypoints, end]);
  });

  it("falls back to a straight segment when a box is missing and no waypoints", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 100 };
    expect(routeConnectionPoints(start, null, end, box(100, 100))).toEqual([
      start,
      end,
    ]);
  });
});

import {
  routeAvoiding,
  routeAroundObstacles,
  routeHitsObstacles,
  segmentHitsBox,
} from "./orthogonal-route";

const obstacle = (cx: number, cy: number, hx = 30, hy = 30): BodyBox => ({
  cx,
  cy,
  hx,
  hy,
});

describe("segmentHitsBox", () => {
  it("detects a horizontal segment passing through a box", () => {
    expect(segmentHitsBox({ x: 0, y: 100 }, { x: 200, y: 100 }, obstacle(100, 100))).toBe(true);
  });
  it("ignores a segment grazing the box face", () => {
    // y exactly on the top face (cy-hy = 70) → grazing, not crossing.
    expect(segmentHitsBox({ x: 0, y: 70 }, { x: 200, y: 70 }, obstacle(100, 100))).toBe(false);
  });
  it("ignores a segment clear of the box", () => {
    expect(segmentHitsBox({ x: 0, y: 10 }, { x: 200, y: 10 }, obstacle(100, 100))).toBe(false);
  });
});

describe("routeAvoiding", () => {
  it("returns the direct route when nothing is in the way", () => {
    const start = { x: 100, y: 50 };
    const end = { x: 300, y: 90 };
    expect(routeAvoiding(start, "h", end, "h", [])).toEqual(
      routeConnectionPoints(start, box(80, 50), end, box(320, 90)),
    );
  });

  it("detours around an obstacle straddling the straight run", () => {
    // Horizontal run y=100 from x=40 to x=360; a box centred on it must be avoided.
    const start = { x: 40, y: 100 };
    const end = { x: 360, y: 100 };
    const blocker = obstacle(200, 100, 40, 40);
    const route = routeAvoiding(start, "h", end, "h", [blocker]);
    expect(route[0]).toEqual(start);
    expect(route[route.length - 1]).toEqual(end);
    // The resulting path crosses no obstacle and is strictly orthogonal.
    expect(routeHitsObstacles(route, [blocker])).toBe(false);
    expect(route.length).toBeGreaterThan(2); // it had to bend around
    for (let i = 1; i < route.length; i += 1) {
      const dx = route[i].x - route[i - 1].x;
      const dy = route[i].y - route[i - 1].y;
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });

  it("routes around via the grid search directly", () => {
    const route = routeAroundObstacles(
      { x: 40, y: 100 },
      "h",
      { x: 360, y: 100 },
      [obstacle(200, 100, 40, 40)],
    );
    expect(route).not.toBeNull();
    expect(routeHitsObstacles(route!, [obstacle(200, 100, 40, 40)])).toBe(false);
  });
});
