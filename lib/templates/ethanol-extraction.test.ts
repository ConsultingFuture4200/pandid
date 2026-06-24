// Ethanol-extraction template tests: the built model is well-formed so it
// instantiates into a clean, fully-connected diagram.

import { describe, expect, it } from "vitest";
import { isSymbolId } from "@/lib/symbols";
import { placementModelToEdit } from "@/components/canvas/placement-model";
import { ETHANOL_EXTRACTION_TEMPLATE } from "./ethanol-extraction";

describe("ethanol-extraction template", () => {
  const model = ETHANOL_EXTRACTION_TEMPLATE.buildModel();

  it("places every node with a known symbol and a unique id", () => {
    const ids = new Set<string>();
    for (const node of model.nodes) {
      expect(isSymbolId(node.symbolId)).toBe(true);
      expect(ids.has(node.elementId)).toBe(false);
      ids.add(node.elementId);
    }
    expect(model.nodes.length).toBeGreaterThanOrEqual(33);
  });

  it("includes all 14 ball valves, tagged BV-1..BV-14", () => {
    const valveTags = model.nodes
      .filter((n) => n.symbolId === "ball-valve")
      .map((n) => n.attributes.tag);
    expect(valveTags).toHaveLength(14);
    for (let i = 1; i <= 14; i += 1) {
      expect(valveTags).toContain(`BV-${i}`);
    }
  });

  it("wires every edge between two existing nodes, with resolved endpoints", () => {
    const nodeIds = new Set(model.nodes.map((n) => n.elementId));
    const edgeIds = new Set<string>();
    for (const edge of model.edges) {
      expect(edge.symbolId).toBe("process-line");
      expect(nodeIds.has(edge.sourceElementId ?? "")).toBe(true);
      expect(nodeIds.has(edge.targetElementId ?? "")).toBe(true);
      // Both endpoints resolved — required or the SVG export drops the edge.
      expect(edge.start).toBeDefined();
      expect(edge.end).toBeDefined();
      expect(edgeIds.has(edge.elementId)).toBe(false);
      edgeIds.add(edge.elementId);
    }
    expect(model.edges.length).toBeGreaterThanOrEqual(25);
  });

  it("carries the drawing's title block", () => {
    expect(model.sheet?.title).toBe("ETHANOL EXTRACTION SYSTEM P&ID");
    expect(model.sheet?.client).toBe("John Z");
    expect(model.sheet?.drawingNo).toBe("CW-PID-03");
    expect(model.sheet?.revisions).toHaveLength(1);
  });

  it("serializes through the canonical edit converter without throwing", () => {
    const edit = placementModelToEdit(model);
    // Every node + edge becomes a metadata-bearing element.
    expect(edit.elements.length).toBe(model.nodes.length + model.edges.length);
    expect(edit.connections.length).toBe(model.edges.length);
  });
});
