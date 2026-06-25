// Small pure builders for authoring a template's PlacementModel by hand.
//
// Keeps the per-template files (e.g. ethanol-extraction) declarative: place a
// node at a scene point, wire an edge between two ports. Port points are resolved
// here from the symbol library so a template edge carries the `start`/`end`
// scene points BOTH the canvas and the SVG export need — the export drops any
// connection without resolved endpoints (lib/mcp-tools/canonical-state), and the
// points seed the orthogonal router (lib/diagram/orthogonal-route).

import type { PlacedEdge, PlacedNode } from "@/components/canvas/placement-model";
import { getSymbol, type SymbolId } from "@/lib/symbols";
import type { JsonObject } from "@/lib/types";

/** Local-box edge length every symbol port is authored against (0..100). */
const LOCAL_BOX = 100;
/** Default placement footprint (px) — one square the local box maps onto. */
export const TEMPLATE_NODE_SIZE = 100;

/** Resolve a placed symbol's named port to an absolute scene-space point, using
 * the same `origin + (local/100)*size` mapping as the renderer and the canvas. */
export function resolvePort(
  symbolId: SymbolId,
  x: number,
  y: number,
  size: number,
  portId: string,
): { x: number; y: number } {
  const port = getSymbol(symbolId).ports.find((p) => p.id === portId);
  if (port === undefined) {
    throw new Error(`Port '${portId}' does not exist on symbol '${symbolId}'.`);
  }
  return {
    x: x + (port.x / LOCAL_BOX) * size,
    y: y + (port.y / LOCAL_BOX) * size,
  };
}

/** A placed node plus its symbol/origin, so edges can resolve its ports without
 * re-threading geometry. Returned by {@link place}. */
export interface PlacedRef {
  readonly elementId: string;
  readonly symbolId: SymbolId;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly node: PlacedNode;
}

/** Build a node at a scene point (top-left), at the default footprint. */
export function place(
  elementId: string,
  symbolId: SymbolId,
  x: number,
  y: number,
  attributes: JsonObject = {},
): PlacedRef {
  const size = TEMPLATE_NODE_SIZE;
  return {
    elementId,
    symbolId,
    x,
    y,
    size,
    node: { elementId, symbolId, x, y, size, attributes },
  };
}

/** An edge endpoint: a placed node and which of its ports to attach to. */
export interface EndpointRef {
  readonly ref: PlacedRef;
  readonly portId: string;
}

/** Endpoint sugar: `at(node, "right")`. */
export function at(ref: PlacedRef, portId: string): EndpointRef {
  return { ref, portId };
}

/**
 * A `process-line` edge between two equipment ports, with both endpoints bound
 * (source/target element ids) and their port points resolved — so it renders and
 * orthogonally routes identically on the canvas and in the exported sheet.
 */
export function connect(
  elementId: string,
  from: EndpointRef,
  to: EndpointRef,
  attributes: JsonObject = {},
  waypoints?: readonly { readonly x: number; readonly y: number }[],
): PlacedEdge {
  return {
    elementId,
    symbolId: "process-line",
    sourceElementId: from.ref.elementId,
    targetElementId: to.ref.elementId,
    start: resolvePort(from.ref.symbolId, from.ref.x, from.ref.y, from.ref.size, from.portId),
    end: resolvePort(to.ref.symbolId, to.ref.x, to.ref.y, to.ref.size, to.portId),
    attributes,
    ...(waypoints !== undefined && waypoints.length > 0 ? { waypoints } : {}),
  };
}

/** EPS for treating a run / a valve's flow ports as axis-aligned. Port coords are
 * integers scaled by `size`, so sub-pixel slack is ample. */
const RUN_EPS = 0.5;

/** Options for {@link inlineValve}. */
export interface InlineValveOptions {
  /** Position along the run, 0 (at `from`) .. 1 (at `to`). Default 0.5 (centre). */
  readonly at?: number;
  /** Valve footprint (px). Default {@link TEMPLATE_NODE_SIZE}. */
  readonly size?: number;
  /** Attributes for the valve node. */
  readonly attributes?: JsonObject;
  /** Attributes for the two pipe segments [entry, exit]. Default blank. */
  readonly segmentAttributes?: readonly [JsonObject, JsonObject];
  /** Override the valve's geometric [left, right] flow ports. Default: the ports
   * with the smallest / largest local x. */
  readonly flowPorts?: readonly [string, string];
}

/** A valve placed inline on a run, plus the two pipe segments through it. */
export interface InlineValveResult {
  readonly valve: PlacedNode;
  readonly segments: readonly [PlacedEdge, PlacedEdge];
}

/**
 * Place a valve inline on a straight, horizontal pipe run between two endpoints,
 * centred on the run with both halves COLINEAR so the pipe passes cleanly through
 * the valve (DEV-1211). Built on `place`/`connect`/`resolvePort`, so the result
 * persists (save → reload) and renders identically on the canvas and in the
 * exported SVG — it is ordinary nodes + edges, no new state shape.
 *
 * A valve exposes only horizontal (left/right) flow ports, so an inline valve is
 * supported on a HORIZONTAL run (the two endpoint ports share a y). A
 * non-horizontal run would need a rotated valve, which the v1 model does not
 * support, so callers get a clear error rather than a valve the pipe enters at an
 * angle.
 *
 * @throws if the run is not horizontal, `at` is out of [0,1], or the valve lacks
 *   two colinear flow ports.
 */
export function inlineValve(
  elementId: string,
  valveSymbolId: SymbolId,
  from: EndpointRef,
  to: EndpointRef,
  options: InlineValveOptions = {},
): InlineValveResult {
  const t = options.at ?? 0.5;
  if (t < 0 || t > 1) {
    throw new Error(`inlineValve 'at' must be in [0,1]; got ${t}.`);
  }
  const size = options.size ?? TEMPLATE_NODE_SIZE;

  const fromPoint = resolvePort(
    from.ref.symbolId,
    from.ref.x,
    from.ref.y,
    from.ref.size,
    from.portId,
  );
  const toPoint = resolvePort(
    to.ref.symbolId,
    to.ref.x,
    to.ref.y,
    to.ref.size,
    to.portId,
  );
  if (Math.abs(fromPoint.y - toPoint.y) > RUN_EPS) {
    throw new Error(
      "inlineValve supports a horizontal run only (the endpoints must share a " +
        `y); got from.y=${fromPoint.y}, to.y=${toPoint.y}. A vertical inline ` +
        "valve needs a rotated valve, which the v1 model does not support.",
    );
  }
  const runY = fromPoint.y;

  // Resolve the valve's geometric left/right flow ports (smallest/largest local
  // x), which must share a local y so the pipe stays colinear through the valve.
  const ports = getSymbol(valveSymbolId).ports;
  let leftId: string;
  let rightId: string;
  if (options.flowPorts !== undefined) {
    [leftId, rightId] = options.flowPorts;
  } else {
    if (ports.length < 2) {
      throw new Error(
        `Valve '${valveSymbolId}' has fewer than two ports; cannot sit inline.`,
      );
    }
    const byX = [...ports].sort((a, b) => a.x - b.x);
    leftId = byX[0].id;
    rightId = byX[byX.length - 1].id;
  }
  const leftPort = ports.find((p) => p.id === leftId);
  const rightPort = ports.find((p) => p.id === rightId);
  if (leftPort === undefined || rightPort === undefined) {
    throw new Error(
      `Valve '${valveSymbolId}' lacks flow ports '${leftId}'/'${rightId}'.`,
    );
  }
  if (Math.abs(leftPort.y - rightPort.y) > RUN_EPS) {
    throw new Error(
      `Valve '${valveSymbolId}' flow ports '${leftId}'/'${rightId}' are not ` +
        "colinear (different y); cannot sit inline on a horizontal run.",
    );
  }

  // Centre the valve on the run: its flow-port midpoint at the run position, its
  // port line on the run's y.
  const cx = fromPoint.x + (toPoint.x - fromPoint.x) * t;
  const midLocalX = (leftPort.x + rightPort.x) / 2;
  const valveX = cx - (midLocalX / LOCAL_BOX) * size;
  const valveY = runY - (leftPort.y / LOCAL_BOX) * size;
  const valve = place(
    elementId,
    valveSymbolId,
    valveX,
    valveY,
    options.attributes ?? {},
  );

  // Orient entry toward `from`: when the run goes left→right, `from` is on the
  // left, so the pipe enters the valve's left port and leaves the right.
  const goingRight = fromPoint.x <= toPoint.x;
  const entryId = goingRight ? leftId : rightId;
  const exitId = goingRight ? rightId : leftId;
  const segAttrs = options.segmentAttributes ?? [{}, {}];

  const segments: [PlacedEdge, PlacedEdge] = [
    connect(`${elementId}-in`, from, at(valve, entryId), segAttrs[0]),
    connect(`${elementId}-out`, at(valve, exitId), to, segAttrs[1]),
  ];
  return { valve: valve.node, segments };
}
