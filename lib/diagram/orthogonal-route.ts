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
): readonly Point[] {
  // Explicit waypoints win: the pipe passes through them so a run can be steered
  // through a clear lane (DEV-1210). Callers supply axis-aligned points.
  if (waypoints !== undefined && waypoints.length > 0) {
    return [start, ...waypoints, end];
  }
  if (sourceBox !== null && targetBox !== null) {
    return orthogonalRoute(
      start,
      axisOfPoint(sourceBox, start),
      end,
      axisOfPoint(targetBox, end),
    );
  }
  return [start, end];
}
