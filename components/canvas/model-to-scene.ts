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
import {
  LABEL_FONT_FAMILY,
  LABEL_FONT_SIZE,
  LABEL_GLYPH_WIDTH_RATIO,
  TECHNICAL_CONNECTOR_STYLE,
} from "./draw-style";
import type { PlacedNode, PlacementModel } from "./placement-model";

/** Skeleton types an arrow can bind to (Excalidraw binds to generic shapes, not
 * to lines/arrows). Our symbol bodies are rectangles or ellipses; symbols whose
 * primitives are all triangles/lines (e.g. valves) expose no bindable body and
 * their edges fall back to unbound geometry. */
const BINDABLE_SKELETON_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

/** The scene-space centre of a placed node. */
export function nodeCentre(node: PlacedNode): { x: number; y: number } {
  return { x: node.x + node.size / 2, y: node.y + node.size / 2 };
}

/**
 * Where a line from the node's centre toward `toward` exits the node's box — so a
 * connection without a resolved PORT point still attaches at the symbol EDGE
 * facing the other element, never crossing into the middle of the box (DEV-1202
 * follow-up; the SD diagram's pre-fix ghost-port connections have no port
 * geometry). Treats the placement box as a square; precise port attachment comes
 * from stored port points when present.
 */
export function nodeEdgePoint(
  node: PlacedNode,
  toward: { x: number; y: number },
): { x: number; y: number } {
  const cx = node.x + node.size / 2;
  const cy = node.y + node.size / 2;
  const half = node.size / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) {
    return { x: cx, y: cy };
  }
  // Smallest scale that brings the ray to a box face: the face it crosses first.
  const tx = dx !== 0 ? half / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = dy !== 0 ? half / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
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

/** The label text drawn under a node: its tag when set, else the symbol name —
 * so a freshly placed-but-untagged symbol still reads (e.g. "Centrifuge") and a
 * tagged one shows its tag (e.g. "C-101"). */
export function nodeLabelText(node: PlacedNode): string {
  const tag = node.attributes.tag;
  if (typeof tag === "string" && tag.trim().length > 0) {
    return tag.trim();
  }
  return getSymbol(node.symbolId).label;
}

/**
 * A clean centred text skeleton drawn just below a node's symbol, so a placed
 * diagram reads like a real P&ID (DEV-1200). `id` ties it to the owning node for
 * selection. Centred by estimate (text measuring needs a browser): anchor x is
 * the box centre minus half the estimated label width.
 */
export function nodeLabelSkeleton(
  node: PlacedNode,
  id: string,
): ExcalidrawElementSkeleton {
  const text = nodeLabelText(node);
  const estWidth = text.length * LABEL_FONT_SIZE * LABEL_GLYPH_WIDTH_RATIO;
  return {
    type: "text",
    id,
    text,
    x: node.x + node.size / 2 - estWidth / 2,
    y: node.y + node.size + 6,
    fontSize: LABEL_FONT_SIZE,
    fontFamily: LABEL_FONT_FAMILY,
    textAlign: "center",
    roughness: 0,
  } as ExcalidrawElementSkeleton;
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
    // Equipment label (tag or symbol name), tied to the node for selection.
    const labelId = `${node.elementId}::label`;
    skeletons.push(nodeLabelSkeleton(node, labelId));
    sceneToOwner.set(labelId, node.elementId);
  }

  for (const edge of model.edges) {
    const source = edge.sourceElementId
      ? nodeById.get(edge.sourceElementId)
      : undefined;
    const target = edge.targetElementId
      ? nodeById.get(edge.targetElementId)
      : undefined;
    // Endpoint geometry: the stored PORT point when known; otherwise the box EDGE
    // facing the other endpoint (never the centre), so a port-less connection
    // still attaches at the symbol boundary. Each endpoint aims at the other's
    // stored point or centre.
    const sourceCentre = source ? nodeCentre(source) : undefined;
    const targetCentre = target ? nodeCentre(target) : undefined;
    const towardStart = edge.end ?? targetCentre;
    const towardEnd = edge.start ?? sourceCentre;
    const start =
      edge.start ??
      (source && towardStart ? nodeEdgePoint(source, towardStart) : sourceCentre);
    const end =
      edge.end ??
      (target && towardEnd ? nodeEdgePoint(target, towardEnd) : targetCentre);
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
      ...TECHNICAL_CONNECTOR_STYLE,
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
