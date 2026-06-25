// Pure waypoint-capture decision tests (DEV-1210).

import { describe, expect, it } from "vitest";
import {
  arrowEndpoints,
  arrowInteriorWaypoints,
  decideWaypointCapture,
  waypointsKey,
} from "./waypoint-capture";

describe("arrowEndpoints", () => {
  it("returns the first and last points in absolute scene space", () => {
    expect(arrowEndpoints(100, 50, [[0, 0], [40, 0], [40, 30]])).toEqual({
      start: { x: 100, y: 50 },
      end: { x: 140, y: 80 },
    });
  });

  it("returns null for a degenerate arrow", () => {
    expect(arrowEndpoints(0, 0, [[0, 0]])).toBeNull();
  });
});

describe("arrowInteriorWaypoints", () => {
  it("converts relative points to absolute, dropping the bound endpoints", () => {
    // Arrow anchored at (100,50): start [0,0], a bend, end. The bend is interior.
    const interior = arrowInteriorWaypoints(100, 50, [
      [0, 0],
      [40, 0],
      [40, 30],
    ]);
    expect(interior).toEqual([{ x: 140, y: 50 }]);
  });

  it("returns no interior points for a straight 2-point arrow", () => {
    expect(arrowInteriorWaypoints(0, 0, [[0, 0], [100, 0]])).toEqual([]);
  });
});

describe("decideWaypointCapture", () => {
  const interior = [{ x: 140, y: 50 }];

  it("snapshots (no capture) on first sight of an edit session", () => {
    expect(decideWaypointCapture(null, interior)).toEqual({ kind: "snapshot" });
  });

  it("skips when unchanged from the baseline", () => {
    const key = waypointsKey(interior);
    expect(decideWaypointCapture(key, interior)).toEqual({ kind: "skip" });
  });

  it("captures when a point moved", () => {
    const baseline = waypointsKey([{ x: 140, y: 50 }]);
    const moved = [{ x: 180, y: 50 }];
    expect(decideWaypointCapture(baseline, moved)).toEqual({
      kind: "capture",
      waypoints: moved,
    });
  });

  it("captures an empty set when the route was straightened (clears waypoints)", () => {
    const baseline = waypointsKey([{ x: 140, y: 50 }]);
    expect(decideWaypointCapture(baseline, [])).toEqual({
      kind: "capture",
      waypoints: [],
    });
  });
});
