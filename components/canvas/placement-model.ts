// Canvas placement model — the bridge between the live canvas and canonical state
// (DEV-1137 + this task: wire /editor to a real diagram).
//
// The Excalidraw scene alone is not enough to drive the commit pipeline or the
// read/overlay projections: it has no notion of which placed shapes are which
// equipment SYMBOL, which PORTS they expose, what ATTRIBUTES they carry, or which
// arrows are logical CONNECTIONS. `convertToExcalidrawElements` also DROPS
// `customData` (CLAUDE.md fact #1), so that provenance can never live on the
// element. It lives here, in a parallel, element-id-keyed placement model the
// canvas maintains as the human places symbols, and which is serialized two ways:
//
//   - to a source-agnostic `DiagramEdit` for the SINGLE commit pipeline
//     (lib/diagram/commit), so a manual save runs the exact validate→persist path
//     an accepted proposal does (one committer — CLAUDE.md), and
//   - to a `pid`-bearing canonical scene (the structural projection
//     lib/mcp-tools/canonical-state + the proposal overlay read back), so the
//     committed diagram round-trips: what was saved is what reloads and what the
//     overlay draws "already on canvas".
//
// And it is rebuilt on LOAD from a persisted `VersionSnapshot` (scene `pid`
// projection + the parallel metadata store), so the canvas always derives from
// canonical server state, never from a local guess (architecture invariant).
//
// Pure + browser-free + deterministic: no Excalidraw runtime, no I/O. Identical
// input always yields identical output, so it is unit-testable without a canvas.

import type { DiagramEdit } from "@/lib/diagram/commit";
import type { VersionSnapshot } from "@/lib/diagram";
import { getSymbol, isSymbolId, type SymbolId } from "@/lib/symbols";
import { pidSceneSchema } from "@/lib/mcp-tools/canonical-state";
import type { JsonObject } from "@/lib/types";

/** Connector symbol ids — placed elements of these types are edges, not nodes. */
const CONNECTOR_SYMBOLS = new Set<SymbolId>(["process-line", "signal-line"]);

/** A piece of equipment placed on the canvas (a node, not an edge). */
export interface PlacedNode {
  /** Excalidraw scene element id — the join key across scene + metadata. */
  readonly elementId: string;
  readonly symbolId: SymbolId;
  /** Scene-space placement box top-left. */
  readonly x: number;
  readonly y: number;
  /** Edge length (px) of the placement box. */
  readonly size: number;
  /** Per-element attributes (tag, capacity, …) for the parallel metadata store. */
  readonly attributes: JsonObject;
}

/** A logical connection edge between two equipment ports. */
export interface PlacedEdge {
  /** Excalidraw scene element id of the line/arrow representing this edge. */
  readonly elementId: string;
  readonly symbolId: Extract<SymbolId, "process-line" | "signal-line">;
  /** Source endpoint element id (null if unbound/orphan). */
  readonly sourceElementId: string | null;
  /** Target endpoint element id (null if unbound/orphan). */
  readonly targetElementId: string | null;
  /** Resolved source port point in scene space, if known. */
  readonly start?: { readonly x: number; readonly y: number };
  /** Resolved target port point in scene space, if known. */
  readonly end?: { readonly x: number; readonly y: number };
  /** Line attributes (lineId, service, …) for the parallel metadata store. */
  readonly attributes: JsonObject;
}

/**
 * The full structural model of a diagram the canvas maintains. Nodes carry
 * geometry + attributes; edges carry endpoints + attributes. This is everything
 * the commit pipeline, the read projection, and the overlay need — derived from
 * canonical state on load, serialized back to canonical state on save.
 */
export interface PlacementModel {
  readonly nodes: readonly PlacedNode[];
  readonly edges: readonly PlacedEdge[];
  readonly viewport: { readonly width: number; readonly height: number };
}

/** An empty model (a brand-new diagram with nothing placed yet). */
export const EMPTY_PLACEMENT_MODEL: PlacementModel = {
  nodes: [],
  edges: [],
  viewport: { width: 800, height: 600 },
};

/** Narrow a SymbolId to a connector symbol, or null. */
function asConnector(
  symbolId: SymbolId,
): Extract<SymbolId, "process-line" | "signal-line"> | null {
  return symbolId === "process-line" || symbolId === "signal-line"
    ? symbolId
    : null;
}

/**
 * Serialize the model into a source-agnostic `DiagramEdit` for the single commit
 * pipeline. Nodes become placed elements (with their ports + attributes); edges
 * become both connector elements (so the validator sees the line's metadata) and
 * derived `connections`. Mirrors the SC-1 edit builder (sc1-workflow-edit) so a
 * manual save drives the same validate→persist path the round-trip test proves.
 */
export function placementModelToEdit(model: PlacementModel): DiagramEdit {
  return {
    scene: placementModelToScene(model),
    elements: [
      ...model.nodes.map((n) => ({
        id: n.elementId,
        equipmentType: n.symbolId,
        portIds: [...getSymbol(n.symbolId).ports.map((p) => p.id)],
        attributes: n.attributes,
      })),
      ...model.edges.map((e) => ({
        id: e.elementId,
        equipmentType: e.symbolId,
        portIds: [],
        attributes: e.attributes,
      })),
    ],
    connections: model.edges.map((e) => ({
      elementId: e.elementId,
      sourceElementId: e.sourceElementId,
      targetElementId: e.targetElementId,
    })),
  };
}

/**
 * Serialize the model into the canonical Excalidraw scene JSON, carrying the
 * structural `pid` projection the read tools + proposal overlay read back. The
 * scene is the single shape persisted as the version; the `pid` key is what makes
 * the committed diagram round-trip (reload) and what the overlay draws as the
 * "already on canvas" committed side.
 */
export function placementModelToScene(model: PlacementModel): JsonObject {
  return {
    type: "excalidraw",
    // The visible scene elements are owned by Excalidraw at runtime; the persisted
    // structural truth is the `pid` projection below. We persist an empty visual
    // element list and rebuild geometry deterministically from `pid` on load, so
    // the parallel store stays the single source of truth (never `customData`).
    elements: [],
    appState: {},
    pid: {
      placements: model.nodes.map((n) => ({
        elementId: n.elementId,
        symbolId: n.symbolId,
        x: n.x,
        y: n.y,
        size: n.size,
        portIds: [...getSymbol(n.symbolId).ports.map((p) => p.id)],
      })),
      connections: model.edges.map((e) => ({
        elementId: e.elementId,
        sourceElementId: e.sourceElementId,
        targetElementId: e.targetElementId,
        ...(e.start !== undefined ? { start: e.start } : {}),
        ...(e.end !== undefined ? { end: e.end } : {}),
        signal: e.symbolId === "signal-line",
      })),
      viewport: model.viewport,
    },
  };
}

/**
 * Rebuild the placement model from a persisted version snapshot on LOAD: the
 * scene's `pid` projection supplies geometry + edges; the parallel metadata store
 * supplies each element's attributes (joined by element id). Unknown symbol ids
 * are dropped (the canvas never fabricates a type the symbol library does not
 * know). An absent/legacy `pid` projects to an empty model — not an error.
 */
export function snapshotToPlacementModel(
  snapshot: VersionSnapshot,
): PlacementModel {
  const parsed = pidSceneSchema.safeParse(snapshot.version.excalidrawScene);
  const pid = parsed.success ? parsed.data.pid : undefined;

  const attributesById = new Map<string, JsonObject>(
    snapshot.metadata.map((m) => [m.elementId, m.attributes] as const),
  );

  const nodes: PlacedNode[] = (pid?.placements ?? []).flatMap((p) => {
    if (!isSymbolId(p.symbolId) || CONNECTOR_SYMBOLS.has(p.symbolId)) {
      return [];
    }
    return [
      {
        elementId: p.elementId,
        symbolId: p.symbolId,
        x: p.x,
        y: p.y,
        size: p.size ?? 100,
        attributes: attributesById.get(p.elementId) ?? {},
      },
    ];
  });

  const edges: PlacedEdge[] = (pid?.connections ?? []).flatMap((c) => {
    // The persisted edge does not record process vs signal beyond the `signal`
    // flag; recover the connector symbol id from it.
    const symbolId = c.signal ? "signal-line" : "process-line";
    const connector = asConnector(symbolId);
    if (connector === null) {
      return [];
    }
    return [
      {
        elementId: c.elementId,
        symbolId: connector,
        sourceElementId: c.sourceElementId,
        targetElementId: c.targetElementId,
        ...(c.start !== undefined ? { start: c.start } : {}),
        ...(c.end !== undefined ? { end: c.end } : {}),
        attributes: attributesById.get(c.elementId) ?? {},
      },
    ];
  });

  return {
    nodes,
    edges,
    viewport: pid?.viewport ?? { ...EMPTY_PLACEMENT_MODEL.viewport },
  };
}
