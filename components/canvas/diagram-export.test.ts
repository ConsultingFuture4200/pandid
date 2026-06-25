// Tests for the diagram export builder (DEV-1156 line list, DEV-1157 SVG).
// Verifies the exported line list matches the model's connection topology and
// carries each connector's service.

import { describe, expect, it } from "vitest";

import { buildDiagramExport } from "./diagram-export";
import type { PlacementModel } from "./placement-model";

function model(): PlacementModel {
  return {
    nodes: [
      {
        elementId: "c1",
        symbolId: "extraction-column",
        x: 40,
        y: 40,
        size: 100,
        attributes: { tag: "C-101", capacity: "5L", orientation: "vertical" },
      },
      {
        elementId: "t1",
        symbolId: "collection-tank",
        x: 240,
        y: 60,
        size: 100,
        attributes: { tag: "T-101", volume: "50L" },
      },
      // A junction tee — a structural node that must NOT appear in the schedule.
      {
        elementId: "j1",
        symbolId: "junction",
        x: 150,
        y: 60,
        size: 100,
        attributes: {},
      },
    ],
    edges: [
      {
        elementId: "l1",
        symbolId: "process-line",
        sourceElementId: "c1",
        targetElementId: "t1",
        attributes: { lineId: "L-101", service: "product" },
      },
    ],
    viewport: { width: 800, height: 600 },
  };
}

describe("buildDiagramExport", () => {
  it("derives one line row per connection, matching topology + service", () => {
    const { lineRows } = buildDiagramExport(model());
    expect(lineRows).toHaveLength(1);
    expect(lineRows[0]).toMatchObject({
      lineId: "L-101",
      fromTag: "C-101",
      toTag: "T-101",
      service: "product",
      signal: false,
    });
  });

  it("derives an equipment row per piece of equipment, excluding junctions", () => {
    const { equipmentRows } = buildDiagramExport(model());
    expect(equipmentRows).toHaveLength(2); // column + tank, NOT the junction
    expect(equipmentRows.map((r) => r.tag)).toEqual(["C-101", "T-101"]);
    const column = equipmentRows.find((r) => r.tag === "C-101");
    expect(column?.type).toBe("Extraction column");
    expect(column?.equipmentType).toBe("extraction-column");
    expect(column?.attributes).toEqual({ capacity: "5L", orientation: "vertical" });
    expect(equipmentRows.some((r) => r.equipmentType === "junction")).toBe(false);
  });

  it("renders a non-empty SVG of the diagram", () => {
    const { svg } = buildDiagramExport(model());
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});
