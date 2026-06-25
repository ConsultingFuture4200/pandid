// Catalog-wide invariants every template must satisfy so it instantiates into a
// clean, fully-connected, renderable diagram.

import { describe, expect, it } from "vitest";
import { isSymbolId } from "@/lib/symbols";
import { placementModelToEdit } from "@/components/canvas/placement-model";
import { TEMPLATES, getTemplate, listTemplateSummaries } from "./catalog";

describe("template catalog", () => {
  it("exposes a summary per template with unique ids", () => {
    const summaries = listTemplateSummaries();
    expect(summaries).toHaveLength(TEMPLATES.length);
    const ids = new Set(summaries.map((s) => s.id));
    expect(ids.size).toBe(summaries.length);
  });

  it("resolves a known template and rejects an unknown one", () => {
    expect(getTemplate(TEMPLATES[0].id)?.id).toBe(TEMPLATES[0].id);
    expect(getTemplate("nope")).toBeNull();
  });

  describe.each(TEMPLATES.map((t) => [t.id, t] as const))(
    "%s builds a well-formed model",
    (_id, template) => {
      const model = template.buildModel();

      it("places nodes with known symbols and unique ids", () => {
        const ids = new Set<string>();
        for (const node of model.nodes) {
          expect(isSymbolId(node.symbolId)).toBe(true);
          expect(ids.has(node.elementId)).toBe(false);
          ids.add(node.elementId);
        }
        expect(model.nodes.length).toBeGreaterThan(0);
      });

      it("wires every edge between existing nodes with resolved endpoints", () => {
        const nodeIds = new Set(model.nodes.map((nn) => nn.elementId));
        const edgeIds = new Set<string>();
        for (const edge of model.edges) {
          expect(edge.symbolId).toBe("process-line");
          expect(nodeIds.has(edge.sourceElementId ?? "")).toBe(true);
          expect(nodeIds.has(edge.targetElementId ?? "")).toBe(true);
          // Both endpoints resolved, or the SVG export drops the edge.
          expect(edge.start).toBeDefined();
          expect(edge.end).toBeDefined();
          expect(edgeIds.has(edge.elementId)).toBe(false);
          edgeIds.add(edge.elementId);
        }
      });

      it("serializes through the canonical edit converter", () => {
        const edit = placementModelToEdit(model);
        expect(edit.elements.length).toBe(model.nodes.length + model.edges.length);
        expect(edit.connections.length).toBe(model.edges.length);
      });
    },
  );
});
