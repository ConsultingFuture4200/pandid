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
import {
  axisOfPoint,
  bodyBoxFromPlacement,
  boxCentre,
  faceExit,
  routeAvoiding,
  routeOrthogonalBetween,
  type BodyBox,
  type Point,
} from "@/lib/diagram/orthogonal-route";
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

// Connection routing geometry (body boxes, face exits, right-angle routes) is
// shared with the server SVG renderer so the canvas and the exported drawing
// sheet route every pipe identically. The single implementation lives in
// `@/lib/diagram/orthogonal-route`; re-exported here for the canvas's importers.
export { boxCentre, routeOrthogonalBetween, type BodyBox };

/** The scene-space centre of a placed node. */
export function nodeCentre(node: PlacedNode): Point {
  return { x: node.x + node.size / 2, y: node.y + node.size / 2 };
}

/** The visible BODY box of a node: the first rectangle/ellipse/diamond of its
 * symbol scaled to placement; falls back to the placement box for a symbol with
 * no such primitive (e.g. a valve drawn only from triangles). */
export function nodeBodyBox(node: PlacedNode): BodyBox {
  return bodyBoxFromPlacement(node.symbolId, node.x, node.y, node.size);
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
 * Collapse an orthogonal route to its essential corner vertices: drop
 * consecutive duplicate points, then drop any vertex that sits mid-run (collinear
 * with its axis-aligned neighbours). Keeps the first and last points (the bound
 * endpoints). The router emits duplicate/collinear points for straight runs;
 * Excalidraw's point editor needs distinct, corner-only vertices to be editable.
 */
function simplifyRoute(points: ReadonlyArray<Point>): Point[] {
  const EPS = 0.5;
  const dedup: Point[] = [];
  for (const p of points) {
    const last = dedup[dedup.length - 1];
    if (
      last !== undefined &&
      Math.abs(last.x - p.x) <= EPS &&
      Math.abs(last.y - p.y) <= EPS
    ) {
      continue;
    }
    dedup.push(p);
  }
  if (dedup.length <= 2) {
    return dedup;
  }
  const out: Point[] = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i += 1) {
    const a = out[out.length - 1];
    const b = dedup[i];
    const c = dedup[i + 1];
    const verticalRun = Math.abs(a.x - b.x) <= EPS && Math.abs(b.x - c.x) <= EPS;
    const horizontalRun = Math.abs(a.y - b.y) <= EPS && Math.abs(b.y - c.y) <= EPS;
    if (verticalRun || horizontalRun) {
      continue; // b lies on a straight run — redundant
    }
    out.push(b);
  }
  out.push(dedup[dedup.length - 1]);
  return out;
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
    // Group all of a node's shapes + its label so they move as ONE unit when the
    // human drags the symbol (DEV-1206) — Excalidraw moves a whole group together.
    const groupIds = [`grp-${node.elementId}`];
    const nodeSkeletons = symbolToSkeletons(getSymbol(node.symbolId), {
      x: node.x,
      y: node.y,
      size: node.size,
    });
    nodeSkeletons.forEach((skeleton, index) => {
      const id = nodeSkeletonId(node.elementId, index);
      skeletons.push({ ...skeleton, id, groupIds } as ExcalidrawElementSkeleton);
      sceneToOwner.set(id, node.elementId);
      if (
        !bindAnchorByNode.has(node.elementId) &&
        BINDABLE_SKELETON_TYPES.has(skeleton.type)
      ) {
        bindAnchorByNode.set(node.elementId, id);
      }
    });
    // Equipment label (tag or symbol name), grouped + tied to the node.
    const labelId = `${node.elementId}::label`;
    skeletons.push({
      ...nodeLabelSkeleton(node, labelId),
      groupIds,
    } as ExcalidrawElementSkeleton);
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
    if (
      edge.waypoints !== undefined &&
      edge.waypoints.length > 0 &&
      edge.start !== undefined &&
      edge.end !== undefined
    ) {
      // Explicit route: pass through the waypoints (DEV-1210), bypassing the
      // auto-router. The endpoints stay bound so the arrow still tracks drags.
      start = edge.start;
      routePoints = [edge.start, ...edge.waypoints, edge.end];
    } else if (source !== undefined && target !== undefined) {
      const s = edge.start
        ? { point: edge.start, axis: axisOfPoint(nodeBodyBox(source), edge.start) }
        : faceExit(nodeBodyBox(source), nodeCentre(target));
      const e = edge.end
        ? { point: edge.end, axis: axisOfPoint(nodeBodyBox(target), edge.end) }
        : faceExit(nodeBodyBox(target), nodeCentre(source));
      start = s.point;
      // Every OTHER node's body is an obstacle the run bends around (DEV-1210), so
      // a pipe routes past equipment rather than through it — the same routing the
      // SVG export uses, so canvas and exported sheet stay identical. The two
      // endpoints' own bodies are excluded (the pipe meets them at their ports).
      const obstacles = model.nodes
        .filter(
          (other) =>
            other.elementId !== source.elementId &&
            other.elementId !== target.elementId,
        )
        .map(nodeBodyBox);
      // Clean the route to corner-only vertices before it becomes an editable
      // arrow: the router emits duplicate / collinear points for axis-aligned
      // runs, and Excalidraw's native point editor mishandles those (dragging a
      // handle that coincides with another collapses/deletes the line).
      // Simplifying gives one handle per real corner (DEV-1210).
      routePoints = simplifyRoute(
        routeAvoiding(s.point, s.axis, e.point, e.axis, obstacles),
      );
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
