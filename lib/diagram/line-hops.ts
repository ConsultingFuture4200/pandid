// Pipe line-jumps (hops) at crossings — DEV-1208.
//
// Where two pipes cross on a P&ID, one hops over the other with a small arc so a
// crossing reads as "no connection" (vs a tee, which is a dot/junction). Our
// connections are orthogonal routes, so every crossing is a horizontal segment of
// one route meeting a vertical segment of another. Convention: the HORIZONTAL
// segment hops over the vertical one — deterministic (each H×V crossing yields
// exactly one hop), so the rendered SVG stays golden-stable.
//
// Pure geometry: no I/O, no rendering-library dependency. Given a route's points
// and the vertical segments of the OTHER routes, it returns SVG path data with a
// hop arc at each strict-interior crossing, or null when the route has no hops
// (so the caller can keep emitting a plain polyline and existing output is
// unchanged for non-crossing diagrams).

/** A 2D point in scene space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A vertical segment of a route (constant x, spanning [y1, y2], y1 < y2). */
export interface VerticalSegment {
  readonly x: number;
  readonly y1: number;
  readonly y2: number;
}

/** Hop arc radius (px). */
const HOP_RADIUS = 6;
/** Coordinate tolerance: treat deltas this small as zero (axis-aligned tests). */
const EPS = 0.5;

/** The vertical segments of an orthogonal route (for use as other routes' hop
 * obstacles). Zero-length and horizontal segments are ignored. */
export function verticalSegments(points: readonly Point[]): VerticalSegment[] {
  const segs: VerticalSegment[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) > EPS) {
      segs.push({ x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) });
    }
  }
  return segs;
}

/**
 * Crossing x-coordinates where a horizontal segment (at height `y`, from `xFrom`
 * to `xTo`) strictly crosses the interior of an obstacle vertical — ordered along
 * the direction of travel. Strict-interior on BOTH segments excludes shared
 * endpoints (tee junctions where lines legitimately meet), and crossings closer
 * than one hop diameter are merged so adjacent arcs never overlap.
 */
function crossingXs(
  y: number,
  xFrom: number,
  xTo: number,
  obstacles: readonly VerticalSegment[],
): number[] {
  const lo = Math.min(xFrom, xTo);
  const hi = Math.max(xFrom, xTo);
  const xs: number[] = [];
  for (const v of obstacles) {
    if (v.x > lo + EPS && v.x < hi - EPS && y > v.y1 + EPS && y < v.y2 - EPS) {
      xs.push(v.x);
    }
  }
  xs.sort((a, b) => a - b);
  const merged = xs.filter(
    (x, i) => i === 0 || Math.abs(x - xs[i - 1]) > 2 * HOP_RADIUS,
  );
  return xTo < xFrom ? merged.reverse() : merged;
}

/**
 * SVG path `d` for an orthogonal route that hops its horizontal segments over the
 * `obstacles` (the vertical segments of OTHER routes). Returns null when the
 * route crosses nothing, so the caller renders a plain polyline instead and
 * non-crossing diagrams produce byte-identical output to before.
 *
 * Each hop is a semicircle of radius {@link HOP_RADIUS} bulging upward (−y).
 */
export function hopPathData(
  points: readonly Point[],
  obstacles: readonly VerticalSegment[],
  fmt: (n: number) => string,
): string | null {
  if (points.length < 2) {
    return null;
  }
  let hasHops = false;
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const horizontal = Math.abs(a.y - b.y) <= EPS && Math.abs(a.x - b.x) > EPS;
    if (horizontal) {
      const xs = crossingXs(a.y, a.x, b.x, obstacles);
      if (xs.length > 0) {
        hasHops = true;
        const dir = b.x > a.x ? 1 : -1;
        // Bulge upward (−y) regardless of travel direction: in SVG's y-down space
        // that is sweep 1 going right, sweep 0 going left.
        const sweep = dir > 0 ? 1 : 0;
        for (const xc of xs) {
          d += ` L ${fmt(xc - dir * HOP_RADIUS)} ${fmt(a.y)}`;
          d += ` A ${HOP_RADIUS} ${HOP_RADIUS} 0 0 ${sweep} ${fmt(xc + dir * HOP_RADIUS)} ${fmt(a.y)}`;
        }
      }
    }
    d += ` L ${fmt(b.x)} ${fmt(b.y)}`;
  }
  return hasHops ? d : null;
}
