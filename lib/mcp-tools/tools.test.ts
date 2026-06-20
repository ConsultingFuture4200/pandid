/**
 * MCP read-tool tests (DEV-1146).
 *
 * Covers the four read tools end-to-end over the in-memory diagram service, the
 * read-side canonical-state projection, validator integration, account-scoping,
 * and the descriptor registry. All assertions hold the read-only invariant: no
 * tool path writes canonical state.
 */
import { describe, expect, it } from "vitest";
import type { TransportContext } from "@/lib/claude-transport";
import type { JsonObject } from "@/lib/types";
import {
  DiagramService,
  InMemoryDiagramRepository,
} from "@/lib/diagram";
import { listEquipmentTypes } from "@/lib/symbols";
import {
  DiagramServiceActiveSource,
  McpReadError,
  McpReadTools,
  buildCanonicalState,
  buildReadToolDescriptors,
} from "./index";
import type { VersionSnapshot } from "@/lib/diagram";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";

/** A canonical scene carrying the `pid` read-side projection: a column → tank
 * process line and an instrument → tank signal line. */
function pidScene(): JsonObject {
  return {
    pid: {
      placements: [
        {
          elementId: "col-1",
          symbolId: "extraction-column",
          x: 60,
          y: 40,
          size: 100,
          portIds: ["top", "bottom"],
        },
        {
          elementId: "tank-1",
          symbolId: "collection-tank",
          x: 60,
          y: 240,
          size: 100,
          portIds: ["top", "right"],
        },
        {
          elementId: "it-1",
          symbolId: "instrument-bubble",
          x: 240,
          y: 240,
          size: 100,
          portIds: ["process"],
        },
      ],
      connections: [
        {
          elementId: "line-1",
          sourceElementId: "col-1",
          targetElementId: "tank-1",
          start: { x: 110, y: 140 },
          end: { x: 110, y: 240 },
          signal: false,
        },
        {
          elementId: "sig-1",
          sourceElementId: "it-1",
          targetElementId: "tank-1",
          start: { x: 240, y: 290 },
          end: { x: 160, y: 290 },
          signal: true,
        },
      ],
      viewport: { width: 420, height: 400 },
    },
  };
}

/** Save a diagram + version with the PID scene and tagged metadata; returns ids. */
async function seedDiagram(
  diagrams: DiagramService,
  accountId = ACCOUNT,
): Promise<string> {
  const diagram = await diagrams.create({ accountId, name: "Extraction Skid" });
  await diagrams.save({
    accountId,
    diagramId: diagram.id,
    save: {
      excalidrawScene: pidScene(),
      metadata: [
        {
          elementId: "col-1",
          equipmentType: "extraction-column",
          attributes: {
            tag: "EX-101",
            capacity: "50L",
            orientation: "vertical",
          },
        },
        {
          elementId: "tank-1",
          equipmentType: "collection-tank",
          attributes: { tag: "TK-101", volume: "20L" },
        },
        {
          elementId: "it-1",
          equipmentType: "instrument-bubble",
          attributes: { tag: "LT-1", measuredVariable: "level" },
        },
        {
          elementId: "line-1",
          equipmentType: "process-line",
          attributes: { lineId: "P-1" },
        },
      ],
    },
  });
  return diagram.id;
}

function makeTools(diagrams: DiagramService): McpReadTools {
  return new McpReadTools(new DiagramServiceActiveSource(diagrams));
}

function context(diagramId: string, accountId = ACCOUNT): TransportContext {
  return { accountId, activeDiagramId: diagramId };
}

describe("buildCanonicalState (read-side projection)", () => {
  function snapshotFor(scene: JsonObject, metadata: VersionSnapshot["metadata"]): VersionSnapshot {
    return {
      version: {
        id: "00000000-0000-4000-8000-000000000abc",
        diagramId: "00000000-0000-4000-8000-000000000def",
        excalidrawScene: scene,
        createdAt: "2026-06-20T00:00:00.000Z",
      },
      metadata,
    };
  }

  it("projects equipment joined to metadata tags", () => {
    const state = buildCanonicalState(
      snapshotFor(pidScene(), [
        { diagramVersionId: "v", elementId: "col-1", equipmentType: "extraction-column", attributes: { tag: "EX-101" } },
        { diagramVersionId: "v", elementId: "tank-1", equipmentType: "collection-tank", attributes: { tag: "TK-101" } },
        { diagramVersionId: "v", elementId: "it-1", equipmentType: "instrument-bubble", attributes: { tag: "LT-1" } },
      ]),
    );
    expect(state.equipment.map((e) => e.elementId)).toEqual(["col-1", "tank-1", "it-1"]);
    expect(state.equipment[0]).toMatchObject({ equipmentType: "extraction-column", tag: "EX-101" });
    expect(state.connections.map((c) => c.elementId)).toEqual(["line-1", "sig-1"]);
    expect(state.connections[1].signal).toBe(true);
  });

  it("builds a validator snapshot with element ports + connections", () => {
    const state = buildCanonicalState(snapshotFor(pidScene(), []));
    const col = state.validatorSnapshot.elements.find((e) => e.id === "col-1");
    expect(col?.portIds).toEqual(["top", "bottom"]);
    expect(state.validatorSnapshot.connections).toHaveLength(2);
  });

  it("derives a line list with endpoint tags", () => {
    const state = buildCanonicalState(
      snapshotFor(pidScene(), [
        { diagramVersionId: "v", elementId: "col-1", equipmentType: "extraction-column", attributes: { tag: "EX-101" } },
        { diagramVersionId: "v", elementId: "tank-1", equipmentType: "collection-tank", attributes: { tag: "TK-101" } },
        { diagramVersionId: "v", elementId: "line-1", equipmentType: "process-line", attributes: { lineId: "P-1" } },
      ]),
    );
    const processLine = state.lineList.find((r) => r.elementId === "line-1");
    expect(processLine).toMatchObject({
      lineId: "P-1",
      fromTag: "EX-101",
      toTag: "TK-101",
      signal: false,
    });
  });

  it("drops placements with an unknown symbol id", () => {
    const scene: JsonObject = {
      pid: {
        placements: [
          { elementId: "x", symbolId: "not-a-symbol", x: 0, y: 0, portIds: [] },
          { elementId: "tank-1", symbolId: "collection-tank", x: 0, y: 0, portIds: ["top"] },
        ],
        connections: [],
      },
    };
    const state = buildCanonicalState(snapshotFor(scene, []));
    expect(state.equipment.map((e) => e.elementId)).toEqual(["tank-1"]);
  });

  it("omits edges with no resolved endpoint geometry from the render state", () => {
    const scene: JsonObject = {
      pid: {
        placements: [{ elementId: "tank-1", symbolId: "collection-tank", x: 0, y: 0, portIds: ["top"] }],
        connections: [
          { elementId: "dangling", sourceElementId: "tank-1", targetElementId: null, signal: false },
        ],
      },
    };
    const state = buildCanonicalState(snapshotFor(scene, []));
    // Still reported as a structured connection (so the validator can flag it)...
    expect(state.connections).toHaveLength(1);
    // ...but not drawn (no geometry).
    expect(state.renderState.connections).toHaveLength(0);
  });

  it("treats a scene without the pid projection as an empty diagram", () => {
    const state = buildCanonicalState(snapshotFor({ elements: [] }, []));
    expect(state.equipment).toHaveLength(0);
    expect(state.connections).toHaveLength(0);
    expect(state.lineList).toHaveLength(0);
  });
});

describe("get_active_diagram", () => {
  it("returns structured state + a non-empty SVG snapshot", async () => {
    const diagrams = new DiagramService(new InMemoryDiagramRepository());
    const id = await seedDiagram(diagrams);
    const tools = makeTools(diagrams);

    const result = await tools.getActiveDiagram(context(id));

    expect(result.diagram.diagramId).toBe(id);
    expect(result.diagram.versionId).not.toBeNull();
    expect(result.equipment.map((e) => e.tag)).toEqual(["EX-101", "TK-101", "LT-1"]);
    expect(result.connections).toHaveLength(2);
    expect(result.svg).toContain("<svg");
    expect(result.svg).toContain("EX-101"); // tag label rendered
  });

  it("returns an empty diagram (no version) without error", async () => {
    const diagrams = new DiagramService(new InMemoryDiagramRepository());
    const diagram = await diagrams.create({ accountId: ACCOUNT, name: "Empty" });
    const tools = makeTools(diagrams);

    const result = await tools.getActiveDiagram(context(diagram.id));

    expect(result.diagram.versionId).toBeNull();
    expect(result.equipment).toHaveLength(0);
    expect(result.svg).toContain("<svg");
  });
});

describe("list_equipment_types", () => {
  it("returns the full symbol set with required attributes", () => {
    const tools = makeTools(new DiagramService(new InMemoryDiagramRepository()));
    const result = tools.listEquipmentTypes();
    expect(result.equipmentTypes).toEqual(listEquipmentTypes());
    expect(result.equipmentTypes.length).toBeGreaterThan(0);
  });
});

describe("validate_active_diagram", () => {
  it("reports valid for a well-formed diagram", async () => {
    const diagrams = new DiagramService(new InMemoryDiagramRepository());
    const id = await seedDiagram(diagrams);
    const tools = makeTools(diagrams);

    const result = await tools.validateActiveDiagram(context(id));

    expect(result.report.valid).toBe(true);
    expect(result.report.errors).toHaveLength(0);
    expect(result.svg).toContain("<svg");
  });

  it("reports validation errors (orphan endpoint) without committing", async () => {
    const diagrams = new DiagramService(new InMemoryDiagramRepository());
    const diagram = await diagrams.create({ accountId: ACCOUNT, name: "Broken" });
    await diagrams.save({
      accountId: ACCOUNT,
      diagramId: diagram.id,
      save: {
        excalidrawScene: {
          pid: {
            placements: [{ elementId: "tank-1", symbolId: "collection-tank", x: 0, y: 0, portIds: ["top"] }],
            connections: [
              { elementId: "orphan", sourceElementId: "tank-1", targetElementId: null, signal: false },
            ],
          },
        },
        metadata: [
          { elementId: "tank-1", equipmentType: "collection-tank", attributes: { tag: "TK-9" } },
        ],
      },
    });
    const tools = makeTools(diagrams);

    const result = await tools.validateActiveDiagram(context(diagram.id));

    expect(result.report.valid).toBe(false);
    expect(result.report.errors.some((e) => e.code === "endpoint-unbound")).toBe(true);

    // Read-only: validation did NOT add a version.
    const versions = await diagrams.listVersions({ accountId: ACCOUNT, diagramId: diagram.id });
    expect(versions).toHaveLength(1);
  });
});

describe("export_line_list", () => {
  it("returns derived line-list rows + SVG", async () => {
    const diagrams = new DiagramService(new InMemoryDiagramRepository());
    const id = await seedDiagram(diagrams);
    const tools = makeTools(diagrams);

    const result = await tools.exportLineList(context(id));

    expect(result.lineList.map((r) => r.elementId)).toEqual(["line-1", "sig-1"]);
    expect(result.lineList[0]).toMatchObject({ fromTag: "EX-101", toTag: "TK-101" });
    expect(result.svg).toContain("<svg");
  });
});

describe("account scoping (tenant isolation)", () => {
  it("refuses a diagram owned by another account", async () => {
    const diagrams = new DiagramService(new InMemoryDiagramRepository());
    const id = await seedDiagram(diagrams, ACCOUNT);
    const tools = makeTools(diagrams);

    await expect(
      tools.getActiveDiagram(context(id, OTHER_ACCOUNT)),
    ).rejects.toMatchObject({ name: "McpReadError", code: "unauthorized" });
  });

  it("errors with no-active-diagram when the context has no diagram id", async () => {
    const diagrams = new DiagramService(new InMemoryDiagramRepository());
    const tools = makeTools(diagrams);

    await expect(
      tools.getActiveDiagram(context("")),
    ).rejects.toBeInstanceOf(McpReadError);
  });
});

describe("read-tool registry", () => {
  it("registers exactly the four read tools, all read-only", async () => {
    const diagrams = new DiagramService(new InMemoryDiagramRepository());
    const id = await seedDiagram(diagrams);
    const descriptors = buildReadToolDescriptors(makeTools(diagrams));

    expect(descriptors.map((d) => d.name)).toEqual([
      "get_active_diagram",
      "list_equipment_types",
      "validate_active_diagram",
      "export_line_list",
    ]);
    expect(descriptors.every((d) => d.readOnly)).toBe(true);

    // Only list_equipment_types is diagram-independent.
    const independent = descriptors.filter((d) => !d.requiresActiveDiagram);
    expect(independent.map((d) => d.name)).toEqual(["list_equipment_types"]);

    // Each descriptor's call returns JSON-safe output for the resolved context.
    for (const descriptor of descriptors) {
      const out = await descriptor.call(context(id));
      expect(out).toBeTypeOf("object");
    }
  });
});
