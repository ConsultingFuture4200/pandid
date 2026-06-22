// Tests-first for rendering a committed model with BOUND connections (DEV-1193).
//
// The drawn edge was previously unbound — it did not follow when a connected node
// was dragged. Binding is the highest-blast-radius canvas primitive (CLAUDE.md:
// tests first for arrow-binding). Like connection-binding.test.ts, these assert
// the skeleton contract `convertToExcalidrawElements` consumes (an arrow with
// `start`/`end` `{ id }` referencing the bound node bodies) WITHOUT loading the
// browser-only runtime; the live drag-follow is asserted in Playwright.

import { describe, expect, it } from "vitest";

import { modelToSceneSkeletons } from "./model-to-scene";
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

  it("anchors the arrow at the source node centre with a delta to the target", () => {
    const arrow = arrowFor(model(), "edge-1");
    // No stored port points → endpoints fall back to node centres.
    // COLUMN centre = (40+50, 40+50) = (90, 90); TANK centre = (290, 110).
    expect(arrow.x).toBe(90);
    expect(arrow.points[0]).toEqual([0, 0]);
    expect(arrow.points[1]).toEqual([290 - 90, 110 - 90]);
  });

  it("prefers stored resolved port points over node centres", () => {
    const arrow = arrowFor(
      model({
        edges: [{ ...EDGE, start: { x: 105, y: 90 }, end: { x: 255, y: 115 } }],
      }),
      "edge-1",
    );
    expect(arrow.x).toBe(105);
    expect(arrow.y).toBe(90);
    expect(arrow.points[1]).toEqual([255 - 105, 115 - 90]);
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
    // Source binds (column has a rectangle body); target stays unbound.
    expect(arrow.start).toEqual({ id: "el-column::0" });
    expect(arrow.end).toBeUndefined();
    // The edge still draws (geometry from node centres), just unbound at the valve.
    expect(arrow.points[1]).toEqual([290 - 90, 110 - 90]);
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
