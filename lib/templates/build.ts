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
