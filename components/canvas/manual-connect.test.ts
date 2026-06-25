// Tests-first for manual connect — build a model edge from a port-to-port gesture
// (DEV-1194, FR-3). Arrow-binding is the highest-blast-radius canvas primitive
// (CLAUDE.md: tests first). Like connection-binding.test.ts these assert the pure
// adapter without a browser; the live click-to-connect gesture is asserted in
// Playwright.

import { describe, expect, it } from "vitest";

import {
  addEdge,
  buildManualEdge,
  defaultConnectorAttributes,
  nodePortPoints,
  pickNearestPorts,
} from "./manual-connect";
import type { PlacedNode, PlacementModel } from "./placement-model";

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

describe("pickNearestPorts", () => {
  it("chooses the closest source/target port pair", () => {
    // column "right" (65,50)->scene (105,90); tank "left" (15,55)->scene (255,115)
    // is the shortest of all 4x4 combinations for this left-to-right layout.
    expect(pickNearestPorts(COLUMN, TANK)).toEqual({
      sourcePortId: "right",
      targetPortId: "left",
    });
  });

  it("is symmetric in geometry but reports ports for the given roles", () => {
    // Swapping roles: nearest is now tank "left"? No — target on the left of
    // source flips the closest pair to source "left" / target "right".
    expect(pickNearestPorts(TANK, COLUMN)).toEqual({
      sourcePortId: "left",
      targetPortId: "right",
    });
  });
});

describe("nodePortPoints", () => {
  it("returns every port in scene space, in symbol port order", () => {
    // extraction-column ports top(50,10) bottom(50,90) left(35,50) right(65,50)
    // at origin (40,40) size 100 → scene points below; markers must sit exactly
    // where a connection would attach (same geometry buildManualEdge uses).
    expect(nodePortPoints(COLUMN)).toEqual([
      { x: 90, y: 50 },
      { x: 90, y: 130 },
      { x: 75, y: 90 },
      { x: 105, y: 90 },
    ]);
  });
});

describe("defaultConnectorAttributes", () => {
  it("seeds blank lineId + required fields for a process line", () => {
    expect(defaultConnectorAttributes("process-line")).toEqual({
      lineId: "",
      service: "",
    });
  });

  it("seeds only blank lineId for a signal line (no extra required fields)", () => {
    expect(defaultConnectorAttributes("signal-line")).toEqual({ lineId: "" });
  });
});

describe("buildManualEdge", () => {
  it("binds both endpoints and anchors at the resolved port points", () => {
    const edge = buildManualEdge({
      elementId: "edge-1",
      connector: "process-line",
      source: COLUMN,
      target: TANK,
    });
    expect(edge).toMatchObject({
      elementId: "edge-1",
      symbolId: "process-line",
      sourceElementId: "el-column",
      targetElementId: "el-tank",
      start: { x: 105, y: 90 },
      end: { x: 255, y: 115 },
      attributes: { lineId: "", service: "" },
    });
  });

  it("marks a signal line as such with its own default attributes", () => {
    const edge = buildManualEdge({
      elementId: "edge-2",
      connector: "signal-line",
      source: COLUMN,
      target: TANK,
    });
    expect(edge.symbolId).toBe("signal-line");
    expect(edge.attributes).toEqual({ lineId: "" });
  });

  it("rejects a self-loop (both endpoints the same element)", () => {
    expect(() =>
      buildManualEdge({
        elementId: "edge-3",
        connector: "process-line",
        source: COLUMN,
        target: COLUMN,
      }),
    ).toThrow(/distinct elements/);
  });
});

describe("addEdge", () => {
  it("appends an edge without mutating the input model", () => {
    const model: PlacementModel = {
      nodes: [COLUMN, TANK],
      edges: [],
      viewport: { width: 800, height: 600 },
    };
    const edge = buildManualEdge({
      elementId: "edge-1",
      connector: "process-line",
      source: COLUMN,
      target: TANK,
    });
    const next = addEdge(model, edge);
    expect(next.edges).toHaveLength(1);
    expect(next.edges[0].elementId).toBe("edge-1");
    expect(model.edges).toHaveLength(0); // input unchanged
    expect(next.nodes).toBe(model.nodes); // untouched arrays shared
  });
});
