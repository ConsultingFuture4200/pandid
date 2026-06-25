// Hydrocarbon (BHO) extractor template: the closed loop + junction tap are present.

import { describe, expect, it } from "vitest";
import { HYDROCARBON_EXTRACTOR_TEMPLATE } from "./hydrocarbon-extractor";

describe("hydrocarbon extractor template", () => {
  const model = HYDROCARBON_EXTRACTOR_TEMPLATE.buildModel();

  it("has the core closed-loop equipment", () => {
    const tags = model.nodes.map((n) => n.attributes.tag);
    for (const tag of ["ST-201", "CH-201", "EX-201", "CP-201", "H-201", "CD-201", "P-201", "PI-201"]) {
      expect(tags).toContain(tag);
    }
  });

  it("uses a junction to tee the feed line", () => {
    expect(model.nodes.some((n) => n.symbolId === "junction")).toBe(true);
  });

  it("closes the recovery loop from condenser back to the tank, waypointed", () => {
    const condenser = model.nodes.find((n) => n.attributes.tag === "CD-201");
    const tank = model.nodes.find((n) => n.attributes.tag === "ST-201");
    const returnEdge = model.edges.find(
      (e) =>
        e.sourceElementId === condenser?.elementId &&
        e.targetElementId === tank?.elementId,
    );
    expect(returnEdge).toBeDefined();
    expect(returnEdge?.waypoints?.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the projection glyph in the title block", () => {
    expect(model.sheet?.projection).toBe("third-angle");
  });
});
