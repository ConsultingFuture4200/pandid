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
