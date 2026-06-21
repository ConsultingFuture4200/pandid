// Attribute-editor field derivation + pure model-update tests (this task:
// equipment attribute editor for /editor).
//
// What must hold:
//   1. The field list for a node is DERIVED from the symbol library — the
//      implicit identity field plus the symbol's required attributes, with
//      constrained options surfaced for enums — never hardcoded per type.
//   2. "missing" mirrors the validator's `requiredAttributesRule`: blank counts
//      as missing, and an enum value outside its options counts as missing.
//   3. `setNodeAttribute` is a pure, by-id update that does not mutate the input
//      and that — once required fields are filled — produces a model whose
//      `placementModelToEdit` clears the validator (a previously-blocked Save
//      now passes).
//
// Pure (no browser, no I/O) so they pin the logic deterministically.

import { describe, expect, it } from "vitest";

import { getRequiredAttributes } from "@/lib/symbols";
import {
  DiagramCommitPipeline,
  diagramEditSchema,
} from "@/lib/diagram/commit";
import {
  DiagramService,
  InMemoryDiagramRepository,
} from "@/lib/diagram";
import { createConnectivityValidator } from "@/lib/validator";
import {
  findNode,
  nodeAttributeFields,
  setNodeAttribute,
} from "./attribute-fields";
import { placementModelToEdit, type PlacementModel } from "./placement-model";
import type { PlacedNode } from "./placement-model";

const ACCOUNT = "22222222-2222-2222-2222-222222222222";

/** A freshly placed extraction column with all required fields still blank. */
function blankColumn(): PlacedNode {
  return {
    elementId: "col-1",
    symbolId: "extraction-column",
    x: 40,
    y: 40,
    size: 100,
    attributes: { tag: "", capacity: "", orientation: "" },
  };
}

function modelWith(node: PlacedNode): PlacementModel {
  return { nodes: [node], edges: [], viewport: { width: 800, height: 600 } };
}

describe("nodeAttributeFields", () => {
  it("derives the identity field plus the symbol's required attributes, in order", () => {
    const fields = nodeAttributeFields(blankColumn());
    // tag (identity) then the extraction-column required attributes.
    expect(fields.map((f) => f.key)).toEqual([
      "tag",
      ...getRequiredAttributes("extraction-column").map((r) => r.key),
    ]);
    expect(fields[0]).toMatchObject({ key: "tag", label: "Tag", type: "string" });
  });

  it("surfaces the constrained option set for enum attributes (e.g. Orientation)", () => {
    const fields = nodeAttributeFields(blankColumn());
    const orientation = fields.find((f) => f.key === "orientation");
    expect(orientation?.type).toBe("enum");
    expect(orientation?.options).toEqual(["vertical", "horizontal"]);
    // Non-enum fields carry no options.
    expect(fields.find((f) => f.key === "capacity")?.options).toBeUndefined();
  });

  it("uses 'Line ID' as the identity label for connector symbols", () => {
    const line: PlacedNode = {
      elementId: "line-x",
      symbolId: "process-line",
      x: 0,
      y: 0,
      size: 100,
      attributes: {},
    };
    expect(nodeAttributeFields(line)[0]).toMatchObject({
      key: "lineId",
      label: "Line ID",
    });
  });

  it("flags blank required fields as missing and pre-fills set ones", () => {
    const fields = nodeAttributeFields({
      ...blankColumn(),
      attributes: { tag: "EX-101", capacity: "", orientation: "vertical" },
    });
    const byKey = new Map(fields.map((f) => [f.key, f]));
    expect(byKey.get("tag")).toMatchObject({ value: "EX-101", missing: false });
    expect(byKey.get("capacity")).toMatchObject({ value: "", missing: true });
    expect(byKey.get("orientation")).toMatchObject({
      value: "vertical",
      missing: false,
    });
  });

  it("treats whitespace-only and out-of-set enum values as missing (mirrors the validator)", () => {
    const fields = nodeAttributeFields({
      ...blankColumn(),
      attributes: { tag: "   ", capacity: "5L", orientation: "diagonal" },
    });
    const byKey = new Map(fields.map((f) => [f.key, f]));
    // whitespace identity → missing
    expect(byKey.get("tag")?.missing).toBe(true);
    // a non-allowed enum value → missing
    expect(byKey.get("orientation")?.missing).toBe(true);
    // a real string → present
    expect(byKey.get("capacity")?.missing).toBe(false);
  });
});

describe("setNodeAttribute", () => {
  it("returns a new model with the target node's attribute updated (by id)", () => {
    const model = modelWith(blankColumn());
    const next = setNodeAttribute(model, "col-1", "tag", "EX-101");
    expect(next.nodes[0].attributes.tag).toBe("EX-101");
    // Other attributes are preserved.
    expect(next.nodes[0].attributes.capacity).toBe("");
  });

  it("does not mutate the input model or node", () => {
    const model = modelWith(blankColumn());
    const next = setNodeAttribute(model, "col-1", "tag", "EX-101");
    expect(model.nodes[0].attributes.tag).toBe("");
    expect(next).not.toBe(model);
    expect(next.nodes[0]).not.toBe(model.nodes[0]);
  });

  it("returns the model unchanged when the node id is absent", () => {
    const model = modelWith(blankColumn());
    const next = setNodeAttribute(model, "no-such-node", "tag", "X");
    expect(next).toBe(model);
  });
});

describe("findNode", () => {
  it("finds a node by id and returns null for null / unknown ids", () => {
    const model = modelWith(blankColumn());
    expect(findNode(model, "col-1")?.elementId).toBe("col-1");
    expect(findNode(model, null)).toBeNull();
    expect(findNode(model, "nope")).toBeNull();
  });
});

describe("filling required attributes clears the validator", () => {
  it("a blank-attribute node fails validation, and filling via setNodeAttribute makes Save pass", async () => {
    const repo = new InMemoryDiagramRepository();
    const diagrams = new DiagramService(repo);
    const pipeline = new DiagramCommitPipeline(
      diagrams,
      createConnectivityValidator(),
    );
    const diagram = await diagrams.create({ accountId: ACCOUNT, name: "AT" });

    // A single column with all required attributes blank — the exact state of a
    // freshly placed symbol before the human fills the panel.
    let model = modelWith(blankColumn());

    // The blank model is rejected (missing required attributes).
    expect(diagramEditSchema.safeParse(placementModelToEdit(model)).success).toBe(
      true,
    );
    await expect(
      pipeline.commit({
        accountId: ACCOUNT,
        diagramId: diagram.id,
        edit: placementModelToEdit(model),
      }),
    ).rejects.toThrow();

    // Fill each required field via the same pure update the panel calls.
    model = setNodeAttribute(model, "col-1", "tag", "EX-101");
    model = setNodeAttribute(model, "col-1", "capacity", "5L");
    model = setNodeAttribute(model, "col-1", "orientation", "vertical");

    // No field is flagged missing now…
    expect(nodeAttributeFields(model.nodes[0]).every((f) => !f.missing)).toBe(
      true,
    );

    // …and the previously-blocked Save now succeeds through the one pipeline.
    const { snapshot } = await pipeline.commit({
      accountId: ACCOUNT,
      diagramId: diagram.id,
      edit: placementModelToEdit(model),
    });
    expect(snapshot.version.id).toBeDefined();
  });
});
