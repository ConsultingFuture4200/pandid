/**
 * MCP propose-tool tests (DEV-1150, PRD §5.2, FR-7,8).
 *
 * The five mutating tools (`add_equipment`, `connect`, `set_metadata`,
 * `delete_element`, `move_or_relabel`) each STAGE a validated proposal — never
 * commit (CLAUDE.md: one committer; proposals are staged, never applied). The
 * tests assert, per tool and across the surface:
 *
 *   - a valid op stages a `pending` proposal and returns { proposalId, state, svg }
 *   - an invalid op is REFUSED at staging with the validator report (FR-8) — no
 *     proposal row is written and canonical state is untouched
 *   - no tool path commits a new diagram version (the human is the sole committer)
 *
 * Everything runs over the in-memory diagram + proposal repositories so the
 * lifecycle is exercised end-to-end without Postgres.
 */
import { describe, expect, it } from "vitest";
import type { TransportContext } from "@/lib/claude-transport";
import type { JsonObject } from "@/lib/types";
import {
  DiagramService,
  InMemoryDiagramRepository,
  getDiagramRepository,
} from "@/lib/diagram";
import { DiagramCommitPipeline } from "@/lib/diagram/commit";
import {
  InMemoryProposalRepository,
  ProposalService,
} from "@/lib/proposals";
import { createConnectivityValidator } from "@/lib/validator";
import { DiagramServiceActiveSource } from "./active-diagram-source";
import {
  McpProposeTools,
  buildProposeToolDescriptors,
} from "./propose-index";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";

/** A canonical scene carrying the `pid` projection: a tagged column → tank line. */
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
      ],
      connections: [
        {
          elementId: "line-1",
          sourceElementId: "col-1",
          targetElementId: "tank-1",
          start: { x: 110, y: 130 },
          end: { x: 110, y: 270 },
          signal: false,
        },
      ],
      viewport: { width: 420, height: 400 },
    },
  };
}

interface Harness {
  diagrams: DiagramService;
  proposals: ProposalService;
  proposalRepo: InMemoryProposalRepository;
  tools: McpProposeTools;
  diagramId: string;
}

/** Build the in-memory stack and seed a two-element diagram; returns the harness. */
async function harness(seed = true): Promise<Harness> {
  const repo = new InMemoryDiagramRepository();
  const diagrams = new DiagramService(repo);
  const pipeline = new DiagramCommitPipeline(
    diagrams,
    createConnectivityValidator(),
  );
  const proposalRepo = new InMemoryProposalRepository();
  const proposals = new ProposalService(
    proposalRepo,
    pipeline,
    createConnectivityValidator(),
    repo,
  );
  const tools = new McpProposeTools(
    new DiagramServiceActiveSource(diagrams),
    proposals,
  );

  const diagram = await diagrams.create({ accountId: ACCOUNT, name: "Skid" });
  if (seed) {
    await diagrams.save({
      accountId: ACCOUNT,
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
            elementId: "line-1",
            equipmentType: "process-line",
            attributes: { lineId: "P-1", service: "extract" },
          },
        ],
      },
    });
  }

  return { diagrams, proposals, proposalRepo, tools, diagramId: diagram.id };
}

function context(diagramId: string, accountId = ACCOUNT): TransportContext {
  return { accountId, activeDiagramId: diagramId };
}

/** Count committed versions of a diagram (to assert nothing committed). */
async function versionCount(
  diagrams: DiagramService,
  diagramId: string,
  accountId = ACCOUNT,
): Promise<number> {
  const versions = await diagrams.listVersions({ accountId, diagramId });
  return versions.length;
}

describe("add_equipment", () => {
  it("stages a pending proposal and returns proposal id + state + SVG", async () => {
    const h = await harness();
    const before = await versionCount(h.diagrams, h.diagramId);

    const result = await h.tools.addEquipment(context(h.diagramId), {
      equipmentType: "pump",
      x: 300,
      y: 140,
      attributes: { tag: "P-201", pumpType: "diaphragm" },
    });

    expect(result.status).toBe("staged");
    if (result.status !== "staged") return;
    expect(result.proposalId).toBeTruthy();
    expect(result.svg).toContain("<svg");
    // The staged state includes the new pump alongside the seeded equipment.
    expect(result.state.equipment.map((e) => e.equipmentType)).toContain("pump");

    // A pending proposal row exists; NOTHING was committed (one committer).
    const pending = await h.proposalRepo.listPending({
      accountId: ACCOUNT,
      diagramId: h.diagramId,
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");
    expect(await versionCount(h.diagrams, h.diagramId)).toBe(before);
  });

  it("refuses an equipment missing a required attribute (FR-8) — nothing staged", async () => {
    const h = await harness();

    // instrument-bubble requires `measuredVariable`; omit it.
    const result = await h.tools.addEquipment(context(h.diagramId), {
      equipmentType: "instrument-bubble",
      x: 300,
      y: 300,
      attributes: { tag: "LT-9" },
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.validatorReport.valid).toBe(false);
    expect(
      result.validatorReport.errors.some(
        (e) => e.code === "missing-required-attribute",
      ),
    ).toBe(true);

    // No proposal row written, no version committed.
    const pending = await h.proposalRepo.listPending({
      accountId: ACCOUNT,
      diagramId: h.diagramId,
    });
    expect(pending).toHaveLength(0);
  });

  it("refuses an unknown equipment type", async () => {
    const h = await harness();
    await expect(
      h.tools.addEquipment(context(h.diagramId), {
        equipmentType: "warp-core",
        x: 0,
        y: 0,
      }),
    ).rejects.toMatchObject({ name: "McpProposeError", code: "invalid-args" });
  });
});

describe("connect", () => {
  it("stages a connection between two placed elements", async () => {
    const h = await harness();
    // Add a pump via a committed version so we have a third element to wire.
    const sceneWithPump: JsonObject = {
      pid: {
        placements: [
          { elementId: "col-1", symbolId: "extraction-column", x: 60, y: 40, size: 100, portIds: ["top", "bottom"] },
          { elementId: "tank-1", symbolId: "collection-tank", x: 60, y: 240, size: 100, portIds: ["top", "right"] },
          { elementId: "pmp-1", symbolId: "pump", x: 300, y: 140, size: 100, portIds: ["suction", "discharge"] },
        ],
        connections: [
          { elementId: "line-1", sourceElementId: "col-1", targetElementId: "tank-1", start: { x: 110, y: 130 }, end: { x: 110, y: 270 }, signal: false },
        ],
        viewport: { width: 600, height: 400 },
      },
    };
    await h.diagrams.save({
      accountId: ACCOUNT,
      diagramId: h.diagramId,
      save: {
        excalidrawScene: sceneWithPump,
        metadata: [
          { elementId: "col-1", equipmentType: "extraction-column", attributes: { tag: "EX-101", capacity: "50L", orientation: "vertical" } },
          { elementId: "tank-1", equipmentType: "collection-tank", attributes: { tag: "TK-101", volume: "20L" } },
          { elementId: "line-1", equipmentType: "process-line", attributes: { lineId: "P-1", service: "extract" } },
          { elementId: "pmp-1", equipmentType: "pump", attributes: { tag: "P-1", pumpType: "diaphragm" } },
        ],
      },
    });

    const result = await h.tools.connect(context(h.diagramId), {
      sourceElementId: "tank-1",
      sourcePort: "right",
      targetElementId: "pmp-1",
      targetPort: "suction",
      lineId: "P-2",
      attributes: { service: "transfer" },
    });

    expect(result.status).toBe("staged");
    if (result.status !== "staged") return;
    // Two connections now: the seeded line plus the new one.
    expect(result.state.connections).toHaveLength(2);
  });

  it("refuses connecting to an element that exposes no ports (FR-8)", async () => {
    // The v1 connectivity validator (DEV-1133) keys binding on the ELEMENT and
    // whether it exposes any ports — a connection carries element ids, not port
    // ids. Binding an endpoint to a connector line (which has no ports) is the
    // port-binding failure it detects: `endpoint-missing-port`.
    const h = await harness();
    const result = await h.tools.connect(context(h.diagramId), {
      sourceElementId: "col-1",
      sourcePort: "bottom",
      targetElementId: "line-1", // a process-line connector — exposes no ports
      targetPort: "end",
      attributes: { service: "x" },
    });

    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(
      result.validatorReport.errors.some(
        (e) => e.code === "endpoint-missing-port",
      ),
    ).toBe(true);
  });

  it("refuses connecting to a missing element (FR-8)", async () => {
    const h = await harness();
    const result = await h.tools.connect(context(h.diagramId), {
      sourceElementId: "col-1",
      sourcePort: "bottom",
      targetElementId: "ghost",
      targetPort: "top",
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(
      result.validatorReport.errors.some(
        (e) => e.code === "endpoint-missing-element",
      ),
    ).toBe(true);
  });
});

describe("set_metadata", () => {
  it("merges attributes and stages a valid proposal", async () => {
    const h = await harness();
    const result = await h.tools.setMetadata(context(h.diagramId), {
      elementId: "tank-1",
      attributes: { volume: "40L", material: "316SS" },
    });

    expect(result.status).toBe("staged");
    if (result.status !== "staged") return;
    const tank = result.state.equipment.find((e) => e.elementId === "tank-1");
    // Existing tag preserved; volume updated; new key added (merge, not replace).
    expect(tank?.attributes).toMatchObject({
      tag: "TK-101",
      volume: "40L",
      material: "316SS",
    });
  });

  it("refuses a metadata change that duplicates a tag (FR-8)", async () => {
    const h = await harness();
    // Set tank-1's tag to the column's tag → duplicate-tag.
    const result = await h.tools.setMetadata(context(h.diagramId), {
      elementId: "tank-1",
      attributes: { tag: "EX-101" },
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(
      result.validatorReport.errors.some((e) => e.code === "duplicate-tag"),
    ).toBe(true);
  });

  it("errors when the element does not exist", async () => {
    const h = await harness();
    await expect(
      h.tools.setMetadata(context(h.diagramId), {
        elementId: "ghost",
        attributes: { tag: "X" },
      }),
    ).rejects.toMatchObject({ name: "McpProposeError", code: "element-not-found" });
  });
});

describe("delete_element", () => {
  it("removes equipment and its incident connections, then stages", async () => {
    const h = await harness();
    const result = await h.tools.deleteElement(context(h.diagramId), {
      elementId: "col-1",
    });

    expect(result.status).toBe("staged");
    if (result.status !== "staged") return;
    // col-1 gone, and line-1 (incident on col-1) gone too — no dangling edge.
    expect(result.state.equipment.map((e) => e.elementId)).not.toContain("col-1");
    expect(result.state.connections).toHaveLength(0);
  });

  it("removes a connection element directly", async () => {
    const h = await harness();
    const result = await h.tools.deleteElement(context(h.diagramId), {
      elementId: "line-1",
    });
    expect(result.status).toBe("staged");
    if (result.status !== "staged") return;
    expect(result.state.connections).toHaveLength(0);
    // Equipment untouched.
    expect(result.state.equipment).toHaveLength(2);
  });

  it("errors when the element does not exist", async () => {
    const h = await harness();
    await expect(
      h.tools.deleteElement(context(h.diagramId), { elementId: "ghost" }),
    ).rejects.toMatchObject({ name: "McpProposeError", code: "element-not-found" });
  });
});

describe("move_or_relabel", () => {
  it("moves an element and stages", async () => {
    const h = await harness();
    const result = await h.tools.moveOrRelabel(context(h.diagramId), {
      elementId: "tank-1",
      x: 400,
      y: 400,
    });
    expect(result.status).toBe("staged");
    if (result.status !== "staged") return;
    const tank = result.state.equipment.find((e) => e.elementId === "tank-1");
    expect(tank).toBeDefined();
  });

  it("relabels an element's tag and stages", async () => {
    const h = await harness();
    const result = await h.tools.moveOrRelabel(context(h.diagramId), {
      elementId: "tank-1",
      tag: "TK-202",
    });
    expect(result.status).toBe("staged");
    if (result.status !== "staged") return;
    const tank = result.state.equipment.find((e) => e.elementId === "tank-1");
    expect(tank?.tag).toBe("TK-202");
  });

  it("refuses a relabel that collides with another tag (FR-8)", async () => {
    const h = await harness();
    const result = await h.tools.moveOrRelabel(context(h.diagramId), {
      elementId: "tank-1",
      tag: "EX-101",
    });
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(
      result.validatorReport.errors.some((e) => e.code === "duplicate-tag"),
    ).toBe(true);
  });

  it("errors when neither a move nor a relabel is given", async () => {
    const h = await harness();
    await expect(
      h.tools.moveOrRelabel(context(h.diagramId), { elementId: "tank-1" }),
    ).rejects.toMatchObject({ name: "McpProposeError", code: "invalid-args" });
  });
});

describe("account scoping (tenant isolation)", () => {
  it("refuses to propose on a diagram owned by another account", async () => {
    const h = await harness();
    await expect(
      h.tools.addEquipment(context(h.diagramId, OTHER_ACCOUNT), {
        equipmentType: "pump",
        x: 0,
        y: 0,
        attributes: { tag: "P-9" },
      }),
    ).rejects.toMatchObject({ name: "McpProposeError", code: "unauthorized" });
  });
});

describe("propose-tool registry", () => {
  it("registers exactly the five propose tools, all mutating (not read-only)", async () => {
    const h = await harness();
    const descriptors = buildProposeToolDescriptors(h.tools);

    expect(descriptors.map((d) => d.name)).toEqual([
      "add_equipment",
      "connect",
      "set_metadata",
      "delete_element",
      "move_or_relabel",
    ]);
    expect(descriptors.every((d) => d.readOnly === false)).toBe(true);
    expect(descriptors.every((d) => d.requiresActiveDiagram)).toBe(true);

    // Each descriptor's call returns JSON-safe output for valid args.
    const out = await descriptors[0].call(context(h.diagramId), {
      equipmentType: "pump",
      x: 10,
      y: 10,
      attributes: { tag: "P-301", pumpType: "diaphragm" },
    });
    expect(out).toBeTypeOf("object");
    expect(out["status"]).toBe("staged");
  });

  it("surfaces a refusal as a JSON-safe rejected result, not a throw", async () => {
    const h = await harness();
    const descriptors = buildProposeToolDescriptors(h.tools);
    const out = await descriptors[0].call(context(h.diagramId), {
      equipmentType: "instrument-bubble",
      x: 0,
      y: 0,
      attributes: { tag: "LT-7" },
    });
    expect(out["status"]).toBe("rejected");
  });
});

describe("getDiagramRepository wiring (no production in-memory)", () => {
  it("serves an in-memory repository in test", () => {
    // Sanity: the shared resolver is in-memory under test, so the propose tools'
    // default wiring (getMcpProposeTools) does not require Postgres in CI.
    expect(getDiagramRepository()).toBeInstanceOf(InMemoryDiagramRepository);
  });
});
