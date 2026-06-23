// Manual connect — bind on create (DEV-1138 / task 10a, FR-3).
//
// Drawing a connection between two equipment PORTS produces an Excalidraw arrow
// skeleton bound to BOTH endpoint elements. Binding is the fiddliest canvas
// mechanic and the place hand-built diagrams broke before, so this layer is a
// pure, deterministic, browser-free adapter (mirrors symbol-to-skeleton.ts):
// given two already-placed equipment elements and the port chosen on each, it
// emits the arrow skeleton that `convertToExcalidrawElements` turns into a bound
// arrow.
//
// Binding mechanism (verified against @excalidraw/excalidraw transform types):
// an arrow skeleton with `start: { id }` / `end: { id }` makes
// convertToExcalidrawElements populate the arrow's `startBinding` / `endBinding`
// to those element ids and register the arrow in each target's `boundElements`.
// We supply explicit endpoint geometry (the scaled port coordinates) so the
// arrow is drawn port-to-port; Excalidraw then owns the live binding.
//
// SCOPE BOUNDARY: this task is bind-ON-CREATE only. Re-binding when an endpoint
// MOVES or is DELETED is DEV-1139 (task 10b) and is deliberately NOT handled
// here. This module computes the initial bound arrow and nothing else.
//
// IMPORTANT (CLAUDE.md fact #1): no equipment metadata rides on the arrow.
// `convertToExcalidrawElements` drops `customData`; connection attributes
// (lineId, service) live in the parallel metadata store (DEV-1136). The arrow
// skeleton here is purely the geometric + binding edge.

import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

import { getSymbol, type SymbolId, type SymbolPort } from "@/lib/symbols";
import {
  DEFAULT_PLACEMENT_SIZE,
  type PlacementOptions,
} from "./symbol-to-skeleton";
import { TECHNICAL_CONNECTOR_STYLE } from "./draw-style";

/** Symbol-library local box edge length; ports are authored in 0..100. */
const LOCAL_BOX = 100;

/** Connector symbol ids that produce a bound arrow. */
const CONNECTOR_SYMBOLS = new Set<SymbolId>(["process-line", "signal-line"]);

/**
 * An equipment element already placed on the canvas. `elementId` is the id of
 * the Excalidraw element on the scene (the id the arrow binds to); `symbolId`
 * + placement locate its ports in scene space.
 */
export interface PlacedEquipment extends PlacementOptions {
  /** Excalidraw scene element id this endpoint binds to. */
  readonly elementId: string;
  readonly symbolId: SymbolId;
}

/** One endpoint of a connection: a placed element and the chosen port on it. */
export interface ConnectionEndpoint {
  readonly element: PlacedEquipment;
  /** Port id from the symbol definition (e.g. "right", "suction"). */
  readonly portId: string;
}

/** Inputs describing a manual connection drawn between two equipment ports. */
export interface ConnectionRequest {
  readonly source: ConnectionEndpoint;
  readonly target: ConnectionEndpoint;
  /** Which connector symbol the line is (solid process / dashed signal). */
  readonly connector: SymbolId;
}

/** A point in placed scene space. */
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/** Scale a local-space coordinate (0..LOCAL_BOX) into placed scene space. */
function scale(local: number, origin: number, size: number): number {
  return origin + (local / LOCAL_BOX) * size;
}

/** Resolve a port id on a placed element to its scene-space (x, y). */
export function portScenePoint(endpoint: ConnectionEndpoint): ScenePoint {
  const { element, portId } = endpoint;
  const def = getSymbol(element.symbolId);
  const port: SymbolPort | undefined = def.ports.find((p) => p.id === portId);
  if (port === undefined) {
    throw new Error(
      `Port '${portId}' does not exist on symbol '${element.symbolId}'. ` +
        `Choose one of: ${def.ports.map((p) => p.id).join(", ")}.`,
    );
  }
  const size = element.size ?? DEFAULT_PLACEMENT_SIZE;
  return {
    x: scale(port.x, element.x, size),
    y: scale(port.y, element.y, size),
  };
}

/**
 * Build a bound arrow skeleton for a manual connection between two equipment
 * ports. The returned skeleton, passed to `convertToExcalidrawElements`, yields
 * an arrow whose `startBinding`/`endBinding` reference the two endpoint elements
 * by id (real element ports — FR-3) and whose geometry runs port-to-port.
 *
 * Deterministic and pure: identical inputs always yield identical output, which
 * is what makes the 🟡 golden snapshot stable.
 *
 * @throws if the connector is not a connector symbol, if the two endpoints are
 *   the same element (a self-loop is not a valid connection), or if a named port
 *   does not exist on its element. Fail loud at the boundary — never emit a
 *   half-bound arrow.
 */
export function buildBoundConnection(
  request: ConnectionRequest,
): ExcalidrawElementSkeleton {
  const { source, target, connector } = request;

  if (!CONNECTOR_SYMBOLS.has(connector)) {
    throw new Error(
      `Symbol '${connector}' is not a connector; ` +
        `connections must be 'process-line' or 'signal-line'.`,
    );
  }
  if (source.element.elementId === target.element.elementId) {
    throw new Error(
      "A connection must join two distinct elements; " +
        `both endpoints reference element '${source.element.elementId}'.`,
    );
  }

  const startPoint = portScenePoint(source);
  const endPoint = portScenePoint(target);
  const dashed = connector === "signal-line";

  // Arrow points are relative to the element's (x, y) anchor; anchor at the
  // source port so the first point is (0, 0) and the second is the delta to the
  // target port. The start/end `{ id }` are what bind to the real elements.
  return {
    type: "arrow",
    x: startPoint.x,
    y: startPoint.y,
    points: [
      [0, 0],
      [endPoint.x - startPoint.x, endPoint.y - startPoint.y],
    ],
    start: { id: source.element.elementId },
    end: { id: target.element.elementId },
    strokeStyle: dashed ? "dashed" : "solid",
    ...TECHNICAL_CONNECTOR_STYLE,
  } as ExcalidrawElementSkeleton;
}
