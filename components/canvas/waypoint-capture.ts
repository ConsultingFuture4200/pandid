// Capture on-canvas waypoint edits (DEV-1210).
//
// When the user enters Excalidraw's linear-element point editor and drags a
// connection arrow's bend, those interior points become the edge's explicit
// `waypoints` (so the route locks and survives save/reload). The tricky part is
// NOT locking a line the moment the user merely INSPECTS it: an auto-routed edge
// already carries its L/Z bends as interior points, so entering edit mode must
// only snapshot a baseline, and a real change (a drag) is what captures.
//
// This module is the pure decision core — no React, no Excalidraw runtime — so
// the capture rule is unit-tested deterministically; pid-canvas wires it to the
// live `onChange`.

/** An absolute scene-space route point. */
export interface InteriorPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The interior route points of an edited arrow in absolute scene space — the
 * bend points, excluding the two bound endpoints (first/last). Excalidraw arrow
 * `points` are relative to the element's (x, y) anchor.
 */
export function arrowInteriorWaypoints(
  x: number,
  y: number,
  points: readonly (readonly [number, number])[],
): InteriorPoint[] {
  return points.slice(1, -1).map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
}

/** A stable, rounded key for change detection between onChange ticks. */
export function waypointsKey(points: readonly InteriorPoint[]): string {
  return points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join("|");
}

/**
 * The arrow's bound endpoints (first and last points) in absolute scene space,
 * or null for a degenerate arrow. A captured route MUST pin these onto the edge:
 * the reload router only honours waypoints when the edge ALSO carries
 * `start`/`end` (model-to-scene), so capturing waypoints alone would silently
 * lose the hand-routing for any edge whose endpoints were not already resolved.
 */
export function arrowEndpoints(
  x: number,
  y: number,
  points: readonly (readonly [number, number])[],
): { readonly start: InteriorPoint; readonly end: InteriorPoint } | null {
  if (points.length < 2) {
    return null;
  }
  const first = points[0];
  const last = points[points.length - 1];
  return {
    start: { x: x + first[0], y: y + first[1] },
    end: { x: x + last[0], y: y + last[1] },
  };
}

/** What the canvas should do with a point-edit tick. */
export type CaptureDecision =
  /** First sight of this element in an edit session — record the baseline, do
   * not capture (so merely inspecting an auto-routed line never locks it). */
  | { readonly kind: "snapshot" }
  /** No change since the baseline — ignore. */
  | { readonly kind: "skip" }
  /** The user moved a point — persist these as the edge's waypoints (empty =
   * the route was straightened, so clear the edge's waypoints). */
  | { readonly kind: "capture"; readonly waypoints: readonly InteriorPoint[] };

/**
 * Decide what to do with one point-edit tick. `baselineKey` is the key recorded
 * when this element's edit session began, or null when the element being edited
 * differs from the baseline (a fresh session). Pure.
 */
export function decideWaypointCapture(
  baselineKey: string | null,
  interior: readonly InteriorPoint[],
): CaptureDecision {
  const currentKey = waypointsKey(interior);
  if (baselineKey === null) {
    return { kind: "snapshot" };
  }
  if (currentKey === baselineKey) {
    return { kind: "skip" };
  }
  return { kind: "capture", waypoints: interior };
}
