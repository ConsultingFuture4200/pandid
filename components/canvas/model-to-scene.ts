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

/** A 2D point in scene space. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** The scene-space centre of a placed node. */
export function nodeCentre(node: PlacedNode): Point {
  return { x: node.x + node.size / 2, y: node.y + node.size / 2 };
}

/** Axis a pipe leaves a box along: horizontal (a left/right face) or vertical
 * (a top/bottom face). */
type RouteAxis = "h" | "v";

/** Centre + half-extents of a box (a node's visible BODY, or a live scene element)
 * — what connections attach to, so a pipe meets the drawn symbol rather than the
 * looser placement box / empty margin. */
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

/** The visible BODY box of a node: the first rectangle/ellipse/diamond of its
 * symbol scaled to placement; falls back to the placement box for a symbol with
 * no such primitive (e.g. a valve drawn only from triangles). */
export function nodeBodyBox(node: PlacedNode): BodyBox {
  const body = getSymbol(node.symbolId).primitives.find(
    (p) =>
      p.shape === "rectangle" ||
      p.shape === "ellipse" ||
      p.shape === "diamond",
  );
  if (body === undefined) {
    const h = node.size / 2;
    return { cx: node.x + h, cy: node.y + h, hx: h, hy: h };
  }
  const w = (body.width / 100) * node.size;
  const ht = (body.height / 100) * node.size;
  return {
    cx: node.x + (body.x / 100) * node.size + w / 2,
    cy: node.y + (body.y / 100) * node.size + ht / 2,
    hx: w / 2,
    hy: ht / 2,
  };
}

/**
 * Exit point + axis on the node's body face nearest the `toward` direction: the
 * MIDPOINT of the left/right (or top/bottom) face the pipe should leave from.
 * Used when a connection has no stored port point, so the line leaves a clean,
 * perpendicular point on the symbol edge instead of the box centre.
 */
function faceExit(
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
function axisOfPoint(box: BodyBox, point: Point): RouteAxis {
  const { cx, cy, hx, hy } = box;
  return Math.abs(point.x - cx) / hx >= Math.abs(point.y - cy) / hy ? "h" : "v";
}

/**
 * Right-angle route between two boxes (their body faces), as an arrow anchor +
 * relative points. Each end leaves the midpoint of the face nearest the other
 * box. Shared by the initial render and the on-move reflow (DEV-1204) so a
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
 * Right-angle route between two endpoints given the axis each leaves along.
 * Same axis on both ends → a Z with one perpendicular mid-run (split at the
 * midpoint); opposite axes → a single L-bend. Returns the absolute points
 * including the endpoints; collinear cases collapse to a straight line.
 */
function orthogonalRoute(
  start: { x: number; y: number },
  startAxis: RouteAxis,
  end: { x: number; y: number },
  endAxis: RouteAxis,
): ReadonlyArray<{ x: number; y: number }> {
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
    const startAnchor = edge.sourceElementId
      ? bindAnchorByNode.get(edge.sourceElementId)
      : undefined;
    const endAnchor = edge.targetElementId
      ? bindAnchorByNode.get(edge.targetElementId)
      : undefined;

    // Endpoint geometry + ORTHOGONAL right-angle route (DEV-1204). With both nodes
    // known, each endpoint leaves the midpoint of its body face toward the other
    // (or its stored port point), and an L-/Z-bend joins them. Without both nodes
    // (orphan/partial), fall back to a straight segment between known points.
    let start: Point;
    let routePoints: ReadonlyArray<Point>;
    if (source !== undefined && target !== undefined) {
      const s = edge.start
        ? { point: edge.start, axis: axisOfPoint(nodeBodyBox(source), edge.start) }
        : faceExit(nodeBodyBox(source), nodeCentre(target));
      const e = edge.end
        ? { point: edge.end, axis: axisOfPoint(nodeBodyBox(target), edge.end) }
        : faceExit(nodeBodyBox(target), nodeCentre(source));
      start = s.point;
      routePoints = orthogonalRoute(s.point, s.axis, e.point, e.axis);
    } else {
      const s = edge.start ?? (source ? nodeCentre(source) : undefined);
      const e = edge.end ?? (target ? nodeCentre(target) : undefined);
      if (s === undefined || e === undefined) {
        // Orphan endpoint (no bound node, no stored point): nothing to draw.
        continue;
      }
      start = s;
      routePoints = [s, e];
    }
    const points = routePoints.map(
      (p) => [p.x - start.x, p.y - start.y] as [number, number],
    );

    skeletons.push({
      type: "arrow",
      id: edge.elementId,
      x: start.x,
      y: start.y,
      points,
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
