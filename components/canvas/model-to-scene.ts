// Render a committed PlacementModel into Excalidraw element skeletons (DEV-1193).
//
// This is the pure, browser-free adapter the canvas uses to draw a loaded
// diagram: given the structural {@link PlacementModel}, it emits the full
// skeleton list (equipment bodies + connection arrows) plus a scene-element-id →
// owner map for selection resolution. `pid-canvas` passes the skeletons through a
// SINGLE `convertToExcalidrawElements(..., { regenerateIds: false })` call and
// writes the result with `updateScene`.
//
// Why a single call with stable ids: `convertToExcalidrawElements` resolves an
// arrow skeleton's `start`/`end` `{ id }` bindings ONLY against sibling skeletons
// in the SAME call (it maps each skeleton's id through an internal
// old→new id table, then binds). Drawing nodes and edges in separate calls — as
// the canvas did before — leaves every rendered edge UNBOUND, so it does not
// follow when a connected node is dragged (DEV-1193). Building one skeleton list
// here, with each node body carrying a deterministic id an edge can reference,
// is what makes the binding resolve (same contract as `buildBoundConnection`,
// DEV-1138/1139).
//
// IMPORTANT (CLAUDE.md fact #1): no equipment metadata rides on the skeletons.
// `convertToExcalidrawElements` drops `customData`; attributes live in the
// parallel metadata store keyed by element id. These skeletons are purely the
// geometric + binding scene.
//
// Pure + deterministic + no Excalidraw runtime: identical input always yields
// identical output, so the binding contract is unit-testable without a browser
// (the established pattern — see connection-binding.test.ts).

import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

import { getSymbol } from "@/lib/symbols";
import { symbolToSkeletons } from "./symbol-to-skeleton";
import type { PlacedNode, PlacementModel } from "./placement-model";

/** Skeleton types an arrow can bind to (Excalidraw binds to generic shapes, not
 * to lines/arrows). Our symbol bodies are rectangles or ellipses; symbols whose
 * primitives are all triangles/lines (e.g. valves) expose no bindable body and
 * their edges fall back to unbound geometry. */
const BINDABLE_SKELETON_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

/** The scene-space centre of a placed node, used as a connection endpoint when
 * no resolved port point is stored. */
export function nodeCentre(node: PlacedNode): { x: number; y: number } {
  return { x: node.x + node.size / 2, y: node.y + node.size / 2 };
}

/** The skeletons to render plus a scene-element-id → owning element-id map. The
 * map resolves a selected shape (a node renders to several shapes) back to its
 * owning node/edge; with stable ids the scene element ids equal the skeleton ids
 * assigned here. */
export interface SceneSkeletons {
  readonly skeletons: readonly ExcalidrawElementSkeleton[];
  readonly sceneToOwner: ReadonlyMap<string, string>;
}

/** Deterministic scene id for the i-th skeleton of a node. */
function nodeSkeletonId(elementId: string, index: number): string {
  return `${elementId}::${index}`;
}

/**
 * Build the scene skeletons (with bound connection arrows) for a committed model.
 *
 * Each node renders to its symbol skeletons; the first bindable skeleton becomes
 * the node's arrow-binding anchor. Each edge renders to an arrow anchored at its
 * resolved port points (or node centres), bound to its source/target anchors via
 * `start`/`end` `{ id }` so Excalidraw makes the line track node moves. An edge
 * whose endpoint has no bound node (orphan) or whose bound node exposes no
 * bindable body is drawn with geometry only — never half-bound.
 */
export function modelToSceneSkeletons(model: PlacementModel): SceneSkeletons {
  const nodeById = new Map(model.nodes.map((n) => [n.elementId, n]));
  const sceneToOwner = new Map<string, string>();
  const skeletons: ExcalidrawElementSkeleton[] = [];
  // node elementId → scene id of its bindable body, for edge binding.
  const bindAnchorByNode = new Map<string, string>();

  for (const node of model.nodes) {
    const nodeSkeletons = symbolToSkeletons(getSymbol(node.symbolId), {
      x: node.x,
      y: node.y,
      size: node.size,
    });
    nodeSkeletons.forEach((skeleton, index) => {
      const id = nodeSkeletonId(node.elementId, index);
      skeletons.push({ ...skeleton, id } as ExcalidrawElementSkeleton);
      sceneToOwner.set(id, node.elementId);
      if (
        !bindAnchorByNode.has(node.elementId) &&
        BINDABLE_SKELETON_TYPES.has(skeleton.type)
      ) {
        bindAnchorByNode.set(node.elementId, id);
      }
    });
  }

  for (const edge of model.edges) {
    const source = edge.sourceElementId
      ? nodeById.get(edge.sourceElementId)
      : undefined;
    const target = edge.targetElementId
      ? nodeById.get(edge.targetElementId)
      : undefined;
    const start = edge.start ?? (source ? nodeCentre(source) : undefined);
    const end = edge.end ?? (target ? nodeCentre(target) : undefined);
    if (start === undefined || end === undefined) {
      // Orphan endpoint (no bound node, no stored point): nothing to draw.
      continue;
    }

    const startAnchor = edge.sourceElementId
      ? bindAnchorByNode.get(edge.sourceElementId)
      : undefined;
    const endAnchor = edge.targetElementId
      ? bindAnchorByNode.get(edge.targetElementId)
      : undefined;

    skeletons.push({
      type: "arrow",
      id: edge.elementId,
      x: start.x,
      y: start.y,
      points: [
        [0, 0],
        [end.x - start.x, end.y - start.y],
      ],
      strokeStyle: edge.symbolId === "signal-line" ? "dashed" : "solid",
      // Bind each endpoint to its node body so the arrow follows node drags
      // (DEV-1193). Omit when the endpoint has no bindable body — never emit a
      // half-bound arrow.
      ...(startAnchor !== undefined ? { start: { id: startAnchor } } : {}),
      ...(endAnchor !== undefined ? { end: { id: endAnchor } } : {}),
    } as ExcalidrawElementSkeleton);
    sceneToOwner.set(edge.elementId, edge.elementId);
  }

  return { skeletons, sceneToOwner };
}
