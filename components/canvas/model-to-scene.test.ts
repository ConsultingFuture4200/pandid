// Tests-first for rendering a committed model with BOUND connections (DEV-1193).
//
// The drawn edge was previously unbound — it did not follow when a connected node
// was dragged. Binding is the highest-blast-radius canvas primitive (CLAUDE.md:
// tests first for arrow-binding). Like connection-binding.test.ts, these assert
// the skeleton contract `convertToExcalidrawElements` consumes (an arrow with
// `start`/`end` `{ id }` referencing the bound node bodies) WITHOUT loading the
// browser-only runtime; the live drag-follow is asserted in Playwright.

import { describe, expect, it } from "vitest";

import {
  modelToSceneSkeletons,
  nodeBodyBox,
  routeOrthogonalBetween,
} from "./model-to-scene";
import type { PlacedEdge, PlacedNode, PlacementModel } from "./placement-model";

const COLUMN: PlacedNode = {
  elementId: "el-column",
  symbolId: "extraction-column",
  x: 40,
  y: 40,
  size: 100,
  attributes: { tag: "C-101" },
};
const TANK: PlacedNode = {
  elementId: "el-tank",
  symbolId: "collection-tank",
  x: 240,
  y: 60,
  size: 100,
  attributes: { tag: "T-101" },
};
const EDGE: PlacedEdge = {
  elementId: "edge-1",
  symbolId: "process-line",
  sourceElementId: "el-column",
  targetElementId: "el-tank",
  attributes: { service: "product" },
};

function model(over: Partial<PlacementModel> = {}): PlacementModel {
  return {
    nodes: [COLUMN, TANK],
    edges: [EDGE],
    viewport: { width: 800, height: 600 },
    ...over,
  };
}

/** An arrow skeleton in the rendered output, narrowed for assertions. */
interface ArrowSkeleton {
  type: string;
  id: string;
  x: number;
  y: number;
  start?: { id: string };
  end?: { id: string };
  strokeStyle?: string;
  points: [number, number][];
}

function arrowFor(m: PlacementModel, edgeId: string): ArrowSkeleton {
  const arrow = modelToSceneSkeletons(m).skeletons.find(
    (s) => s.type === "arrow" && (s as { id?: string }).id === edgeId,
  );
  if (arrow === undefined) {
    throw new Error(`No arrow skeleton for edge '${edgeId}'`);
  }
  return arrow as unknown as ArrowSkeleton;
}

/** Assert every segment of a route is axis-aligned (horizontal or vertical) —
 * i.e. the connector is orthogonal right-angle piping (DEV-1204). */
function expectOrthogonal(points: [number, number][]): void {
  expect(points.length).toBeGreaterThanOrEqual(2);
  expect(points[0]).toEqual([0, 0]);
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    // Exactly one of dx/dy is non-zero on each segment (a degenerate 0,0 segment
    // is also fine — collinear collapse).
    expect(dx === 0 || dy === 0).toBe(true);
  }
}

describe("modelToSceneSkeletons — bound connections (DEV-1193)", () => {
  it("binds the rendered edge to the source and target node bodies", () => {
    const arrow = arrowFor(model(), "edge-1");
    // The node body is the first (only) skeleton of each node → `${id}::0`.
    expect(arrow.start).toEqual({ id: "el-column::0" });
    expect(arrow.end).toEqual({ id: "el-tank::0" });
  });

  it("references binding ids that exist among the emitted skeletons", () => {
    const { skeletons } = modelToSceneSkeletons(model());
    const ids = new Set(
      skeletons.map((s) => (s as { id?: string }).id).filter(Boolean),
    );
    const arrow = arrowFor(model(), "edge-1");
    expect(ids.has(arrow.start!.id)).toBe(true);
    expect(ids.has(arrow.end!.id)).toBe(true);
  });

  it("attaches a port-less edge at the body face midpoint and routes orthogonally (DEV-1204)", () => {
    const arrow = arrowFor(model(), "edge-1");
    // Each endpoint leaves the midpoint of its body face toward the other node:
    // COLUMN body right-face (105,90), TANK body left-face (255,115) — both leave
    // horizontally → Z-route bending at midpoint x=180. Relative to (105,90):
    expect(arrow.x).toBe(105);
    expect(arrow.y).toBe(90);
    expect(arrow.points).toEqual([
      [0, 0],
      [75, 0],
      [75, 25],
      [150, 25],
    ]);
  });

  it("prefers stored resolved port points and routes orthogonally between them", () => {
    const arrow = arrowFor(
      model({
        edges: [{ ...EDGE, start: { x: 105, y: 90 }, end: { x: 255, y: 115 } }],
      }),
      "edge-1",
    );
    // Both ports leave horizontally → Z-route bending at midpoint x=180.
    expect(arrow.x).toBe(105);
    expect(arrow.y).toBe(90);
    expect(arrow.points).toEqual([
      [0, 0],
      [75, 0],
      [75, 25],
      [150, 25],
    ]);
  });

  it("routes through explicit waypoints when start+end+waypoints are present (DEV-1210)", () => {
    const arrow = arrowFor(
      model({
        edges: [
          {
            ...EDGE,
            start: { x: 105, y: 90 },
            end: { x: 255, y: 115 },
            waypoints: [
              { x: 105, y: 300 },
              { x: 255, y: 300 },
            ],
          },
        ],
      }),
      "edge-1",
    );
    // Anchored at start; points pass through both waypoints, relative to start.
    expect(arrow.x).toBe(105);
    expect(arrow.y).toBe(90);
    expect(arrow.points).toEqual([
      [0, 0],
      [0, 210],
      [150, 210],
      [150, 25],
    ]);
  });

  it("marks a signal-line edge dashed and a process-line edge solid", () => {
    expect(arrowFor(model(), "edge-1").strokeStyle).toBe("solid");
    const signal = arrowFor(
      model({ edges: [{ ...EDGE, symbolId: "signal-line" }] }),
      "edge-1",
    );
    expect(signal.strokeStyle).toBe("dashed");
  });

  it("leaves an endpoint unbound when its node exposes no bindable body", () => {
    // gate-valve renders only triangles (line skeletons) → no bindable body.
    const valve: PlacedNode = {
      elementId: "el-valve",
      symbolId: "gate-valve",
      x: 240,
      y: 60,
      size: 100,
      attributes: { tag: "V-1" },
    };
    const arrow = arrowFor(
      model({
        nodes: [COLUMN, valve],
        edges: [{ ...EDGE, targetElementId: "el-valve" }],
      }),
      "edge-1",
    );
    // Source binds (column has a rectangle body); target stays unbound (valve is
    // all triangles). Both are nodes, so the edge still routes orthogonally.
    expect(arrow.start).toEqual({ id: "el-column::0" });
    expect(arrow.end).toBeUndefined();
    expectOrthogonal(arrow.points);
  });

  it("skips an orphan edge endpoint with no bound node and no stored point", () => {
    const orphan: PlacedEdge = {
      elementId: "edge-orphan",
      symbolId: "process-line",
      sourceElementId: "el-column",
      targetElementId: null,
      attributes: {},
    };
    const arrows = modelToSceneSkeletons(
      model({ edges: [orphan] }),
    ).skeletons.filter((s) => s.type === "arrow");
    expect(arrows).toHaveLength(0);
  });

  it("maps every node shape and edge arrow back to its owner element id", () => {
    const { sceneToOwner } = modelToSceneSkeletons(model());
    expect(sceneToOwner.get("el-column::0")).toBe("el-column");
    expect(sceneToOwner.get("el-tank::0")).toBe("el-tank");
    expect(sceneToOwner.get("edge-1")).toBe("edge-1");
  });
});

// A symbol with no bindable body (all lines/triangles) still has a routable box.
// The on-canvas drag reflow (pid-canvas) relies on this fallback: when the OTHER
// end of an edge is dragged, the connection to such a symbol must re-route from
// the symbol's placement box rather than be dropped (the "line disappears" bug).
describe("nodeBodyBox / routeOrthogonalBetween — non-bindable symbol fallback", () => {
  const expansionJoint: PlacedNode = {
    elementId: "el-exp",
    symbolId: "expansion-joint", // primitives are a single line — no bindable body
    x: 100,
    y: 100,
    size: 100,
    attributes: {},
  };

  it("gives a non-bindable symbol a finite placement-box fallback", () => {
    const box = nodeBodyBox(expansionJoint);
    for (const v of [box.cx, box.cy, box.hx, box.hy]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    // Falls back to the full placement box (size 100, centred on the placement).
    expect(box).toEqual({ cx: 150, cy: 150, hx: 50, hy: 50 });
  });

  it("routes orthogonally between a non-bindable box and a moved valve box", () => {
    const movedValveBox = { cx: 320, cy: 40, hx: 8, hy: 8 };
    const route = routeOrthogonalBetween(nodeBodyBox(expansionJoint), movedValveBox);
    expect(Number.isFinite(route.x)).toBe(true);
    expect(Number.isFinite(route.y)).toBe(true);
    expect(route.points.length).toBeGreaterThanOrEqual(2);
    for (const [px, py] of route.points) {
      expect(Number.isFinite(px)).toBe(true);
      expect(Number.isFinite(py)).toBe(true);
    }
    expectOrthogonal(route.points);
  });
});
