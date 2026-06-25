// BizzyBee multi-rack template: the rack shape and recovery loop are present.

import { describe, expect, it } from "vitest";
import { BIZZYBEE_MULTI_RACK_TEMPLATE } from "./bizzybee-multi-rack";

describe("bizzybee multi-rack template", () => {
  const model = BIZZYBEE_MULTI_RACK_TEMPLATE.buildModel();

  it("has six 10 lb material columns tagged MC-1..MC-6", () => {
    const columns = model.nodes.filter((n) => n.symbolId === "extraction-column");
    expect(columns).toHaveLength(6);
    for (const c of columns) {
      expect(c.attributes.capacity).toBe("10 lb");
    }
    const tags = columns.map((c) => c.attributes.tag);
    for (let i = 1; i <= 6; i += 1) {
      expect(tags).toContain(`MC-${i}`);
    }
  });

  it("has an inlet and outlet ball valve per column (12 total)", () => {
    const valves = model.nodes.filter((n) => n.symbolId === "ball-valve");
    expect(valves).toHaveLength(12);
  });

  it("closes the recovery loop back to the solvent tank", () => {
    const condenser = model.nodes.find((n) => n.attributes.tag === "CD-101");
    const tank = model.nodes.find((n) => n.attributes.tag === "ST-101");
    expect(condenser).toBeDefined();
    expect(tank).toBeDefined();
    const returnEdge = model.edges.find(
      (e) =>
        e.sourceElementId === condenser?.elementId &&
        e.targetElementId === tank?.elementId,
    );
    expect(returnEdge).toBeDefined();
  });

  it("carries the multi-rack title block", () => {
    expect(model.sheet?.title).toBe("BIZZYBEE MULTI-RACK — ETHANOL EXTRACTION P&ID");
    expect(model.sheet?.drawingNo).toBe("BB-MR-01");
  });
});
