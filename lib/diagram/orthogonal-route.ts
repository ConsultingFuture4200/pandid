// Orthogonal (right-angle) connection routing — the single source of truth for
// how a pipe is routed between two pieces of equipment (DEV-1204).
//
// Why this is its own module: BOTH render paths must route connections
// identically or the exported drawing sheet won't match the live canvas. The
// canvas (components/canvas/model-to-scene.ts) and the server SVG renderer
// (lib/diagram/render-svg.ts) previously each carried their own copy of this
// math; the SVG copy drew straight diagonals while the canvas drew clean right
// angles, so a placed diagram and its exported sheet diverged. This module is
// the shared, pure geometry both now call. Architecture invariant: the browser
// canvas and the server renderer are both clients of the same routing — they
// must never diverge.
//
// Pure: no Excalidraw runtime, no DOM, no I/O. The only dependency is the symbol
// library (to find an equipment's bindable BODY box). Deterministic.

import { getSymbol, type SymbolId } from "@/lib/symbols";

/** Symbol-library local box edge length; every primitive is authored in 0..100. */
const LOCAL_BOX = 100;

/** A 2D point in scene space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Axis a pipe leaves a box along: horizontal (a left/right face) or vertical
 * (a top/bottom face). */
export type RouteAxis = "h" | "v";

/** Centre + half-extents of a box (a node's visible BODY) — what connections
 * attach to, so a pipe meets the drawn symbol rather than the looser placement
 * box / empty margin. */
export interface BodyBox {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
}

/** Centre point of a body box. */
export function boxCentre(box: BodyBox): Point {
  return { x: box.cx, y: box.cy };
}

/**
 * The visible BODY box of a placed symbol: its first rectangle/ellipse/diamond
 * primitive scaled to placement; falls back to the placement box for a symbol
 * with no such primitive (e.g. a valve drawn only from triangles). Mirrors the
 * canvas `nodeBodyBox`, sharing this one implementation.
 */
export function bodyBoxFromPlacement(
  symbolId: SymbolId,
  x: number,
  y: number,
  size: number,
): BodyBox {
  const body = getSymbol(symbolId).primitives.find(
    (p) =>
      p.shape === "rectangle" ||
      p.shape === "ellipse" ||
      p.shape === "diamond",
  );
  if (body === undefined) {
    const h = size / 2;
    return { cx: x + h, cy: y + h, hx: h, hy: h };
  }
  const w = (body.width / LOCAL_BOX) * size;
  const ht = (body.height / LOCAL_BOX) * size;
  return {
    cx: x + (body.x / LOCAL_BOX) * size + w / 2,
    cy: y + (body.y / LOCAL_BOX) * size + ht / 2,
    hx: w / 2,
    hy: ht / 2,
  };
}

/**
 * Exit point + axis on the box face nearest the `toward` direction: the MIDPOINT
 * of the left/right (or top/bottom) face the pipe should leave from. Used when a
 * connection has no stored port point, so the line leaves a clean, perpendicular
 * point on the symbol edge instead of the box centre.
 */
export function faceExit(
  box: BodyBox,
  toward: Point,
): { readonly point: Point; readonly axis: RouteAxis } {
  const { cx, cy, hx, hy } = box;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  // Normalise by the box half-extents so a tall/narrow body picks the right face.
  if (Math.abs(dx) / hx >= Math.abs(dy) / hy) {
    return { point: { x: dx >= 0 ? cx + hx : cx - hx, y: cy }, axis: "h" };
  }
  return { point: { x: cx, y: dy >= 0 ? cy + hy : cy - hy }, axis: "v" };
}

/** The axis a stored port point implies — which body face it sits nearest. */
export function axisOfPoint(box: BodyBox, point: Point): RouteAxis {
  return Math.abs(point.x - box.cx) / box.hx >=
    Math.abs(point.y - box.cy) / box.hy
    ? "h"
    : "v";
}

/**
 * Right-angle route between two endpoints given the axis each leaves along.
 * Same axis on both ends → a Z with one perpendicular mid-run (split at the
 * midpoint); opposite axes → a single L-bend. Returns the absolute points
 * including the endpoints; collinear cases collapse to a straight line.
 */
export function orthogonalRoute(
  start: Point,
  startAxis: RouteAxis,
  end: Point,
  endAxis: RouteAxis,
): readonly Point[] {
  if (startAxis === "h" && endAxis === "h") {
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  if (startAxis === "v" && endAxis === "v") {
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
  if (startAxis === "h") {
    // h → v: bend at (end.x, start.y).
    return [start, { x: end.x, y: start.y }, end];
  }
  // v → h: bend at (start.x, end.y).
  return [start, { x: start.x, y: end.y }, end];
}

/**
 * Right-angle route between two boxes (their body faces), as an arrow anchor +
 * relative points. Each end leaves the midpoint of the face nearest the other
 * box. Used by the canvas for the initial render and the on-move reflow so a
 * connection routes identically however it is (re)drawn.
 */
export function routeOrthogonalBetween(
  sourceBox: BodyBox,
  targetBox: BodyBox,
): { readonly x: number; readonly y: number; readonly points: [number, number][] } {
  const s = faceExit(sourceBox, boxCentre(targetBox));
  const e = faceExit(targetBox, boxCentre(sourceBox));
  const route = orthogonalRoute(s.point, s.axis, e.point, e.axis);
  return {
    x: s.point.x,
    y: s.point.y,
    points: route.map((p) => [p.x - s.point.x, p.y - s.point.y] as [number, number]),
  };
}

/**
 * Absolute right-angle route for a connection whose endpoints are already known
 * (the stored port points), given the body box at each end. This is the path the
 * server SVG renderer takes: it has the resolved start/end points and the placed
 * equipment, and must reproduce exactly what the canvas draws for the same edge.
 *
 * Matches the canvas's stored-point branch: each endpoint keeps its resolved
 * point and takes the axis of the face that point sits nearest. When a box is
 * missing (an orphan/unbound endpoint), there is no face to route against, so the
 * edge falls back to a straight segment — the same fallback the canvas uses.
 */
export function routeConnectionPoints(
  start: Point,
  sourceBox: BodyBox | null,
  end: Point,
  targetBox: BodyBox | null,
  waypoints?: readonly Point[],
  obstacles?: readonly BodyBox[],
): readonly Point[] {
  // Explicit waypoints win: the pipe passes through them so a run can be steered
  // through a clear lane (DEV-1210). Callers supply axis-aligned points.
  if (waypoints !== undefined && waypoints.length > 0) {
    return [start, ...waypoints, end];
  }
  if (sourceBox !== null && targetBox !== null) {
    return routeAvoiding(
      start,
      axisOfPoint(sourceBox, start),
      end,
      axisOfPoint(targetBox, end),
      obstacles ?? [],
    );
  }
  return [start, end];
}

// --- Obstacle-aware routing (DEV-1210) -------------------------------------
//
// The single L/Z route above is the right answer when nothing is in the way. The
// reference drawings, though, snake pipes AROUND equipment; a straight run that
// crosses a body box reads as a pipe passing THROUGH the vessel. `routeAvoiding`
// keeps the cheap L/Z route whenever it is clear (so existing diagrams — and their
// goldens — are untouched) and only falls back to a multi-bend detour when the
// direct route would cross an obstacle. Pure + deterministic.

/** Clearance (scene px) a detour keeps from an obstacle body. */
const ROUTE_CLEARANCE = 14;
/** Per-bend cost (in px-equivalents) so the search prefers fewer turns. */
const TURN_PENALTY = 40;

/**
 * Does the axis-aligned segment a→b pass through `box`'s interior? The box is
 * inset slightly so a segment running exactly along a face (grazing) does NOT
 * count — only a real crossing does.
 */
export function segmentHitsBox(
  a: Point,
  b: Point,
  box: BodyBox,
  inset = 0.5,
): boolean {
  const minX = box.cx - box.hx + inset;
  const maxX = box.cx + box.hx - inset;
  const minY = box.cy - box.hy + inset;
  const maxY = box.cy + box.hy - inset;
  if (maxX <= minX || maxY <= minY) {
    return false;
  }
  if (Math.abs(a.y - b.y) < 1e-6) {
    if (a.y <= minY || a.y >= maxY) {
      return false;
    }
    return Math.max(a.x, b.x) > minX && Math.min(a.x, b.x) < maxX;
  }
  if (Math.abs(a.x - b.x) < 1e-6) {
    if (a.x <= minX || a.x >= maxX) {
      return false;
    }
    return Math.max(a.y, b.y) > minY && Math.min(a.y, b.y) < maxY;
  }
  return false; // orthogonal routes have no diagonal segments
}

/** Does any segment of `points` cross any obstacle body? */
export function routeHitsObstacles(
  points: readonly Point[],
  obstacles: readonly BodyBox[],
): boolean {
  for (let i = 0; i + 1 < points.length; i += 1) {
    for (const o of obstacles) {
      if (segmentHitsBox(points[i], points[i + 1], o)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Right-angle route between two endpoints that avoids `obstacles`: the cheap L/Z
 * route when it is clear, else a multi-bend detour found by an A* search over the
 * grid of obstacle-clearance lines (fewest bends, then shortest). Falls back to
 * the direct route if no clear path exists (never returns nothing).
 */
export function routeAvoiding(
  start: Point,
  startAxis: RouteAxis,
  end: Point,
  endAxis: RouteAxis,
  obstacles: readonly BodyBox[],
): readonly Point[] {
  const direct = orthogonalRoute(start, startAxis, end, endAxis);
  if (obstacles.length === 0 || !routeHitsObstacles(direct, obstacles)) {
    return direct;
  }
  const detour = routeAroundObstacles(start, startAxis, end, obstacles);
  return detour ?? direct;
}

/**
 * A* over the orthogonal grid formed by the endpoints and each obstacle's
 * clearance edges. Returns the corner points of the cheapest bend-minimal path
 * that crosses no obstacle, or null if the grid admits none. Exported for tests.
 */
export function routeAroundObstacles(
  start: Point,
  startAxis: RouteAxis,
  end: Point,
  obstacles: readonly BodyBox[],
  clearance = ROUTE_CLEARANCE,
): readonly Point[] | null {
  // Candidate coordinate lines: the endpoints plus each obstacle's clearance edges.
  const xs = sortedUnique([
    start.x,
    end.x,
    ...obstacles.flatMap((o) => [o.cx - o.hx - clearance, o.cx + o.hx + clearance]),
  ]);
  const ys = sortedUnique([
    start.y,
    end.y,
    ...obstacles.flatMap((o) => [o.cy - o.hy - clearance, o.cy + o.hy + clearance]),
  ]);
  const sx = xs.indexOf(start.x);
  const sy = ys.indexOf(start.y);
  const ex = xs.indexOf(end.x);
  const ey = ys.indexOf(end.y);
  if (sx < 0 || sy < 0 || ex < 0 || ey < 0) {
    return null;
  }
  const pointAt = (ix: number, iy: number): Point => ({ x: xs[ix], y: ys[iy] });
  const passable = (a: Point, b: Point): boolean =>
    !obstacles.some((o) => segmentHitsBox(a, b, o));

  // A* state: grid cell + incoming direction (to price turns). dir: 0 none, 1 h, 2 v.
  interface State {
    readonly ix: number;
    readonly iy: number;
    readonly dir: 0 | 1 | 2;
  }
  const key = (s: State): string => `${s.ix},${s.iy},${s.dir}`;
  const startDir: 0 | 1 | 2 = startAxis === "h" ? 1 : 2;
  const startState: State = { ix: sx, iy: sy, dir: startDir };
  const h = (ix: number, iy: number): number =>
    Math.abs(xs[ix] - end.x) + Math.abs(ys[iy] - end.y);

  const gScore = new Map<string, number>([[key(startState), 0]]);
  const cameFrom = new Map<string, State>();
  // Small grids → a plain array used as a priority queue is fine.
  const open: { state: State; f: number }[] = [
    { state: startState, f: h(sx, sy) },
  ];

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (open[i].f < open[bestIdx].f) {
        bestIdx = i;
      }
    }
    const { state } = open.splice(bestIdx, 1)[0];
    if (state.ix === ex && state.iy === ey) {
      return reconstruct(cameFrom, state, key, pointAt);
    }
    const g = gScore.get(key(state)) ?? Infinity;
    const here = pointAt(state.ix, state.iy);
    const moves: { ix: number; iy: number; dir: 1 | 2 }[] = [
      { ix: state.ix - 1, iy: state.iy, dir: 1 },
      { ix: state.ix + 1, iy: state.iy, dir: 1 },
      { ix: state.ix, iy: state.iy - 1, dir: 2 },
      { ix: state.ix, iy: state.iy + 1, dir: 2 },
    ];
    for (const m of moves) {
      if (m.ix < 0 || m.ix >= xs.length || m.iy < 0 || m.iy >= ys.length) {
        continue;
      }
      const there = pointAt(m.ix, m.iy);
      if (!passable(here, there)) {
        continue;
      }
      const step = Math.abs(there.x - here.x) + Math.abs(there.y - here.y);
      const turn = state.dir !== 0 && state.dir !== m.dir ? TURN_PENALTY : 0;
      const next: State = { ix: m.ix, iy: m.iy, dir: m.dir };
      const tentative = g + step + turn;
      if (tentative < (gScore.get(key(next)) ?? Infinity)) {
        gScore.set(key(next), tentative);
        cameFrom.set(key(next), state);
        open.push({ state: next, f: tentative + h(m.ix, m.iy) });
      }
    }
  }
  return null;
}

function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function reconstruct(
  cameFrom: Map<string, { ix: number; iy: number; dir: 0 | 1 | 2 }>,
  goal: { ix: number; iy: number; dir: 0 | 1 | 2 },
  key: (s: { ix: number; iy: number; dir: 0 | 1 | 2 }) => string,
  pointAt: (ix: number, iy: number) => Point,
): Point[] {
  const cells: { ix: number; iy: number }[] = [];
  let cur: { ix: number; iy: number; dir: 0 | 1 | 2 } | undefined = goal;
  while (cur !== undefined) {
    cells.push({ ix: cur.ix, iy: cur.iy });
    cur = cameFrom.get(key(cur));
  }
  cells.reverse();
  // Cell path → points, dropping any vertex collinear with its neighbours.
  const raw = cells.map((c) => pointAt(c.ix, c.iy));
  const out: Point[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const prev = out[out.length - 1];
    const p = raw[i];
    if (prev !== undefined && prev.x === p.x && prev.y === p.y) {
      continue;
    }
    out.push(p);
  }
  const simplified: Point[] = [];
  for (let i = 0; i < out.length; i += 1) {
    if (i > 0 && i < out.length - 1) {
      const a = simplified[simplified.length - 1];
      const b = out[i];
      const c = out[i + 1];
      const collinearH = a.y === b.y && b.y === c.y;
      const collinearV = a.x === b.x && b.x === c.x;
      if (collinearH || collinearV) {
        continue;
      }
    }
    simplified.push(out[i]);
  }
  return simplified;
}
