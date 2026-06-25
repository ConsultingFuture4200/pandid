// Manual connect — build a model edge from a human port-to-port gesture
// (DEV-1194, FR-3). The canvas lets a human pick a connector then click a source
// and a target equipment node; this pure adapter turns that gesture into a
// {@link PlacedEdge} for the structural model (which `model-to-scene` then renders
// as a BOUND arrow, DEV-1193, and the commit pipeline persists).
//
// It reuses `connection-binding`'s `portScenePoint` so manual edges anchor at the
// SAME real symbol ports as Claude-proposed ones — one geometry source, no
// drift. Port selection is automatic: the source/target port PAIR with the
// smallest scene-space distance, so the drawn line takes the shortest sensible
// route without a port-picker UI. Deterministic (ties broken by symbol port
// order), so it is unit-testable without a browser.
//
// IMPORTANT (CLAUDE.md fact #1): no metadata rides on the arrow. The edge seeds
// BLANK required connector attributes (identity `lineId` + the connector's
// required fields) so the element exists immediately and the validator reports
// exactly what the human still must fill — mirroring node placement
// (`defaultAttributes` in pid-canvas) and the validator's `requiredAttributesRule`.

import { getSymbol, getRequiredAttributes, type SymbolId } from "@/lib/symbols";
import type { JsonObject } from "@/lib/types";
import { portScenePoint, type PlacedEquipment } from "./connection-binding";
import type { PlacedEdge, PlacedNode, PlacementModel } from "./placement-model";

/** The connector symbol ids a manual connection can be. */
export type ConnectorSymbolId = Extract<
  SymbolId,
  "process-line" | "signal-line"
>;

/** Identity attribute key for a connector (mirrors the validator, PRD §6). */
const CONNECTOR_ID_KEY = "lineId";

/** Adapt a PlacedNode to the {@link PlacedEquipment} shape `portScenePoint` reads. */
function toEquipment(node: PlacedNode): PlacedEquipment {
  return {
    elementId: node.elementId,
    symbolId: node.symbolId,
    x: node.x,
    y: node.y,
    size: node.size,
  };
}

/** A chosen source/target port pair. */
export interface PortPair {
  readonly sourcePortId: string;
  readonly targetPortId: string;
}

/**
 * Pick the source/target port pair with the smallest scene-space distance
 * between them. Deterministic: scans ports in symbol-definition order and keeps
 * the first minimum, so identical inputs always yield the same pair.
 *
 * @throws if either node's symbol exposes no ports (nothing to bind to).
 */
export function pickNearestPorts(
  source: PlacedNode,
  target: PlacedNode,
): PortPair {
  const sourcePorts = getSymbol(source.symbolId).ports;
  const targetPorts = getSymbol(target.symbolId).ports;
  if (sourcePorts.length === 0 || targetPorts.length === 0) {
    throw new Error(
      `Cannot connect: ${
        sourcePorts.length === 0 ? source.symbolId : target.symbolId
      } exposes no ports.`,
    );
  }

  const srcEquip = toEquipment(source);
  const tgtEquip = toEquipment(target);
  let best: { d2: number; pair: PortPair } | null = null;
  for (const sp of sourcePorts) {
    const spPoint = portScenePoint({ element: srcEquip, portId: sp.id });
    for (const tp of targetPorts) {
      const tpPoint = portScenePoint({ element: tgtEquip, portId: tp.id });
      const dx = spPoint.x - tpPoint.x;
      const dy = spPoint.y - tpPoint.y;
      const d2 = dx * dx + dy * dy;
      if (best === null || d2 < best.d2) {
        best = { d2, pair: { sourcePortId: sp.id, targetPortId: tp.id } };
      }
    }
  }
  // `best` is non-null because both port lists are non-empty.
  return best!.pair;
}

/**
 * Seed blank required attributes for a connector: identity `lineId` plus every
 * declared required field (e.g. `service` for a process line), each empty so the
 * validator reports precisely what the human must fill before Save.
 */
export function defaultConnectorAttributes(
  connector: ConnectorSymbolId,
): JsonObject {
  const attributes: JsonObject = { [CONNECTOR_ID_KEY]: "" };
  for (const required of getRequiredAttributes(connector)) {
    attributes[required.key] = "";
  }
  return attributes;
}

/** Inputs describing a manual connection drawn between two equipment nodes. */
export interface ManualEdgeRequest {
  /** Unique element id for the new edge. */
  readonly elementId: string;
  /** Connector kind: solid process line or dashed signal line. */
  readonly connector: ConnectorSymbolId;
  readonly source: PlacedNode;
  readonly target: PlacedNode;
}

/**
 * Build a {@link PlacedEdge} for a manual port-to-port connection. The edge binds
 * both endpoints to their nodes (so `model-to-scene` draws a bound, drag-tracking
 * arrow) and stores the resolved port points as its initial geometry. Attributes
 * start blank for the human to fill.
 *
 * @throws if source and target are the same element (a self-loop is not a valid
 *   connection) or if a node exposes no ports.
 */
export function buildManualEdge(request: ManualEdgeRequest): PlacedEdge {
  const { elementId, connector, source, target } = request;
  if (source.elementId === target.elementId) {
    throw new Error(
      "A connection must join two distinct elements; " +
        `both endpoints reference element '${source.elementId}'.`,
    );
  }
  const { sourcePortId, targetPortId } = pickNearestPorts(source, target);
  const start = portScenePoint({
    element: toEquipment(source),
    portId: sourcePortId,
  });
  const end = portScenePoint({
    element: toEquipment(target),
    portId: targetPortId,
  });
  return {
    elementId,
    symbolId: connector,
    sourceElementId: source.elementId,
    targetElementId: target.elementId,
    start,
    end,
    attributes: defaultConnectorAttributes(connector),
  };
}

/** Append an edge to the model. Pure: never mutates the input model. */
export function addEdge(
  model: PlacementModel,
  edge: PlacedEdge,
): PlacementModel {
  return { ...model, edges: [...model.edges, edge] };
}

/**
 * Scene-space points of every port on a node — the markers the canvas shows on a
 * picked source while connecting, so the human sees where a line will snap
 * (DEV-1254). Reuses `portScenePoint` (the same geometry `buildManualEdge`
 * anchors to), so a marker sits exactly where a connection would attach. Pure.
 */
export function nodePortPoints(
  node: PlacedNode,
): { readonly x: number; readonly y: number }[] {
  const equip = toEquipment(node);
  return getSymbol(node.symbolId).ports.map((p) =>
    portScenePoint({ element: equip, portId: p.id }),
  );
}
