// Tests for the connectivity validator (DEV-1133, PRD §5.3 FR-11..13).
//
// Tests-first per CLAUDE.md (validator is a high-blast-radius primitive). Each
// FR-11 rule gets an explicit failing case AND a passing case:
//   (a) endpoint binds to a real element port
//   (b) no orphan / dangling connections
//   (c) equipment tags unique within the diagram
//   (d) required metadata present per equipment type
// Plus: the interface lets a v2 domain rule slot in without caller changes (FR-12),
// and errors are actionable (which element, which rule — FR-13).

import { describe, expect, it } from "vitest";

import type { ElementMetadata, JsonObject } from "@/lib/types";
import {
  createConnectivityValidator,
  createValidator,
  type DiagramElement,
  type DiagramSnapshot,
  type ValidationRule,
} from "./index";

const VERSION_ID = "00000000-0000-4000-8000-000000000000";

// --- snapshot builders ------------------------------------------------------

function element(
  id: string,
  equipmentType: DiagramElement["equipmentType"],
  portIds: readonly string[],
): DiagramElement {
  return { id, equipmentType, portIds };
}

function meta(
  elementId: string,
  equipmentType: ElementMetadata["equipmentType"],
  attributes: JsonObject,
): ElementMetadata {
  return { diagramVersionId: VERSION_ID, elementId, equipmentType, attributes };
}

/** A fully valid two-equipment + one-connection diagram. The passing baseline. */
function validSnapshot(): DiagramSnapshot {
  return {
    elements: [
      element("pump-1", "pump", ["suction", "discharge"]),
      element("tank-1", "collection-tank", ["top", "bottom", "left", "right"]),
      element("line-1", "process-line", ["start", "end"]),
    ],
    connections: [
      { elementId: "line-1", sourceElementId: "pump-1", targetElementId: "tank-1" },
    ],
    metadata: [
      meta("pump-1", "pump", { tag: "P-101", pumpType: "centrifugal" }),
      meta("tank-1", "collection-tank", { tag: "TK-201", volume: "200 L" }),
      meta("line-1", "process-line", { lineId: "L-1", service: "ethanol" }),
    ],
  };
}

// --- valid baseline ---------------------------------------------------------

describe("connectivity validator — valid baseline", () => {
  it("passes a fully-bound, fully-tagged diagram with no errors", () => {
    const report = createConnectivityValidator().validate(validSnapshot());
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });
});

// --- rule (b): no orphan / dangling connections -----------------------------

describe("rule (b) — orphan / dangling connections", () => {
  it("FAILS when a connection endpoint is unbound", () => {
    const snapshot = validSnapshot();
    const broken: DiagramSnapshot = {
      ...snapshot,
      connections: [
        { elementId: "line-1", sourceElementId: "pump-1", targetElementId: null },
      ],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual(
      expect.objectContaining({ code: "endpoint-unbound", elementId: "line-1" }),
    );
  });

  it("PASSES once the dangling endpoint is bound", () => {
    const report = createConnectivityValidator().validate(validSnapshot());
    expect(report.errors.some((e) => e.code === "endpoint-unbound")).toBe(false);
  });
});

// --- rule (a): endpoint binds to a real element port ------------------------

describe("rule (a) — endpoint binds to a real element", () => {
  it("FAILS when an endpoint references a non-existent element", () => {
    const snapshot = validSnapshot();
    const broken: DiagramSnapshot = {
      ...snapshot,
      connections: [
        { elementId: "line-1", sourceElementId: "ghost-9", targetElementId: "tank-1" },
      ],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual(
      expect.objectContaining({
        code: "endpoint-missing-element",
        elementId: "line-1",
      }),
    );
  });

  it("FAILS when an endpoint binds to an element exposing no ports", () => {
    const snapshot = validSnapshot();
    const broken: DiagramSnapshot = {
      ...snapshot,
      elements: [
        ...snapshot.elements,
        element("portless-1", "pump", []),
      ],
      connections: [
        {
          elementId: "line-1",
          sourceElementId: "portless-1",
          targetElementId: "tank-1",
        },
      ],
      metadata: [
        ...snapshot.metadata,
        meta("portless-1", "pump", { tag: "P-999", pumpType: "gear" }),
      ],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.errors).toContainEqual(
      expect.objectContaining({
        code: "endpoint-missing-port",
        elementId: "line-1",
      }),
    );
  });

  it("PASSES when both endpoints bind to real, ported elements", () => {
    const report = createConnectivityValidator().validate(validSnapshot());
    expect(
      report.errors.some(
        (e) =>
          e.code === "endpoint-missing-element" ||
          e.code === "endpoint-missing-port",
      ),
    ).toBe(false);
  });
});

// --- rule (c): unique equipment tags ----------------------------------------

describe("rule (c) — equipment tags unique within diagram", () => {
  it("FAILS when two equipment elements share a tag", () => {
    const snapshot = validSnapshot();
    const broken: DiagramSnapshot = {
      ...snapshot,
      metadata: [
        meta("pump-1", "pump", { tag: "DUP-1", pumpType: "centrifugal" }),
        meta("tank-1", "collection-tank", { tag: "DUP-1", volume: "200 L" }),
        meta("line-1", "process-line", { lineId: "L-1", service: "ethanol" }),
      ],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.valid).toBe(false);
    const dupErrors = report.errors.filter((e) => e.code === "duplicate-tag");
    // Reported on BOTH offending elements so the UI can highlight all of them.
    expect(dupErrors.map((e) => e.elementId).sort()).toEqual(["pump-1", "tank-1"]);
  });

  it("does NOT flag connectors (lineId) under the equipment-tag rule", () => {
    // Two process lines sharing a lineId would be a connector concern, not (c).
    const twoLines: DiagramSnapshot = {
      elements: [
        element("line-1", "process-line", ["start", "end"]),
        element("line-2", "process-line", ["start", "end"]),
      ],
      connections: [],
      metadata: [
        meta("line-1", "process-line", { lineId: "L-1", service: "ethanol" }),
        meta("line-2", "process-line", { lineId: "L-1", service: "ethanol" }),
      ],
    };
    const report = createConnectivityValidator().validate(twoLines);
    expect(report.errors.some((e) => e.code === "duplicate-tag")).toBe(false);
  });

  it("PASSES with distinct tags", () => {
    const report = createConnectivityValidator().validate(validSnapshot());
    expect(report.errors.some((e) => e.code === "duplicate-tag")).toBe(false);
  });
});

// --- rule (d): required metadata present ------------------------------------

describe("rule (d) — required metadata present per type", () => {
  it("FAILS when the implicit identity tag is missing", () => {
    const snapshot = validSnapshot();
    const broken: DiagramSnapshot = {
      ...snapshot,
      metadata: [
        meta("pump-1", "pump", { pumpType: "centrifugal" }), // no tag
        meta("tank-1", "collection-tank", { tag: "TK-201", volume: "200 L" }),
        meta("line-1", "process-line", { lineId: "L-1", service: "ethanol" }),
      ],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.valid).toBe(false);
    expect(report.errors).toContainEqual(
      expect.objectContaining({
        code: "missing-required-attribute",
        elementId: "pump-1",
      }),
    );
  });

  it("FAILS when a type-specific required attribute is absent", () => {
    const snapshot = validSnapshot();
    const broken: DiagramSnapshot = {
      ...snapshot,
      metadata: [
        meta("pump-1", "pump", { tag: "P-101" }), // missing pumpType
        meta("tank-1", "collection-tank", { tag: "TK-201", volume: "200 L" }),
        meta("line-1", "process-line", { lineId: "L-1", service: "ethanol" }),
      ],
    };
    const report = createConnectivityValidator().validate(broken);
    const pumpErrors = report.errors.filter(
      (e) => e.code === "missing-required-attribute" && e.elementId === "pump-1",
    );
    expect(pumpErrors.length).toBeGreaterThan(0);
  });

  it("FAILS when an element has no metadata row at all", () => {
    const broken: DiagramSnapshot = {
      elements: [element("pump-1", "pump", ["suction", "discharge"])],
      connections: [],
      metadata: [],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.valid).toBe(false);
    expect(
      report.errors.every((e) => e.code === "missing-required-attribute"),
    ).toBe(true);
  });

  it("FAILS when an enum attribute holds a value outside its options", () => {
    const broken: DiagramSnapshot = {
      elements: [element("col-1", "extraction-column", ["top", "bottom"])],
      connections: [],
      metadata: [
        meta("col-1", "extraction-column", {
          tag: "C-101",
          capacity: "50 L",
          orientation: "diagonal", // not vertical|horizontal
        }),
      ],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.errors).toContainEqual(
      expect.objectContaining({
        code: "missing-required-attribute",
        elementId: "col-1",
      }),
    );
  });

  it("treats whitespace-only attribute values as missing", () => {
    const broken: DiagramSnapshot = {
      elements: [element("pump-1", "pump", ["suction", "discharge"])],
      connections: [],
      metadata: [meta("pump-1", "pump", { tag: "   ", pumpType: "gear" })],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.valid).toBe(false);
  });

  it("PASSES when all required attributes are present and valid", () => {
    const report = createConnectivityValidator().validate(validSnapshot());
    expect(
      report.errors.some((e) => e.code === "missing-required-attribute"),
    ).toBe(false);
  });
});

// --- FR-13: actionable errors -----------------------------------------------

describe("FR-13 — actionable errors", () => {
  it("names the offending element and a remediation in each message", () => {
    const broken: DiagramSnapshot = {
      elements: [element("pump-1", "pump", ["suction"])],
      connections: [],
      metadata: [meta("pump-1", "pump", {})],
    };
    const report = createConnectivityValidator().validate(broken);
    expect(report.errors.length).toBeGreaterThan(0);
    for (const error of report.errors) {
      expect(error.elementId).toBeTruthy();
      expect(error.message).toContain("pump-1");
      expect(error.message.length).toBeGreaterThan(10);
    }
  });
});

// --- FR-12: interface extensibility (v2 rules slot in) ----------------------

describe("FR-12 — v2 domain rules slot in without caller changes", () => {
  it("composes an extra rule alongside the connectivity rules", () => {
    // A stand-in v2 domain rule. The caller surface (createValidator + report)
    // is unchanged — this is exactly how v2 process-topology rules will register.
    const everythingFailsRule: ValidationRule = {
      code: "test-domain-rule",
      validate(snapshot) {
        return snapshot.elements.map((el) => ({
          code: "missing-required-attribute" as const,
          elementId: el.id,
          message: `domain rule rejected ${el.id}`,
        }));
      },
    };

    const baseline = createConnectivityValidator().validate(validSnapshot());
    expect(baseline.valid).toBe(true);

    const withDomainRule = createValidator([everythingFailsRule]);
    const report = withDomainRule.validate(validSnapshot());
    expect(report.valid).toBe(false);
    expect(report.errors).toHaveLength(validSnapshot().elements.length);
  });

  it("an empty rule set validates everything as valid (interface contract)", () => {
    const report = createValidator([]).validate(validSnapshot());
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
  });
});
