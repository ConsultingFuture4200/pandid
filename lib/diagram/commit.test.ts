import { beforeEach, describe, expect, it } from "vitest";
import { isSymbolId, type SymbolId } from "@/lib/symbols";
import type { JsonObject } from "@/lib/types";
import { createConnectivityValidator } from "@/lib/validator";
import { CommitBlockedError, DiagramCommitPipeline } from "./commit";
import type { CommitInput } from "./commit";
import { InMemoryDiagramRepository } from "./in-memory-repository";
import { DiagramService } from "./service";
import { DiagramError } from "./types";

const ACCOUNT = crypto.randomUUID();
const OTHER_ACCOUNT = crypto.randomUUID();

/** Narrow a fixture's controlled equipment-type string to a SymbolId. */
function asSymbolId(value: string): SymbolId {
  if (!isSymbolId(value)) {
    throw new Error(`fixture uses unknown symbol id: ${value}`);
  }
  return value;
}

const SCENE: JsonObject = {
  type: "excalidraw",
  elements: [],
  appState: {},
};

/**
 * A connected, fully-attributed two-tank diagram joined by a process line.
 * `collection-tank` and `process-line` are real symbol ids from DEV-1131;
 * `tag` (equipment) and `lineId` (connector) are the implicit identity fields,
 * `volume` / `service` the symbols' required attributes — so the fixture passes
 * the v1 connectivity validator unmodified.
 */
function validEdit(): CommitInput["edit"] {
  return {
    scene: SCENE,
    elements: [
      {
        id: "tank-a",
        equipmentType: "collection-tank",
        portIds: ["top", "bottom"],
        attributes: { tag: "TK-101", volume: "200L" },
      },
      {
        id: "tank-b",
        equipmentType: "collection-tank",
        portIds: ["top", "bottom"],
        attributes: { tag: "TK-102", volume: "200L" },
      },
      {
        id: "line-1",
        equipmentType: "process-line",
        portIds: [],
        attributes: { lineId: "L-1", service: "solvent" },
      },
    ],
    connections: [
      {
        elementId: "line-1",
        sourceElementId: "tank-a",
        targetElementId: "tank-b",
      },
    ],
  };
}

describe("DiagramCommitPipeline", () => {
  let repo: InMemoryDiagramRepository;
  let service: DiagramService;
  let pipeline: DiagramCommitPipeline;
  let diagramId: string;

  beforeEach(async () => {
    repo = new InMemoryDiagramRepository();
    service = new DiagramService(repo);
    pipeline = new DiagramCommitPipeline(service, createConnectivityValidator());
    const diagram = await service.create({ accountId: ACCOUNT, name: "Rig" });
    diagramId = diagram.id;
  });

  it("validates then persists a new immutable version on pass", async () => {
    const result = await pipeline.commit({
      accountId: ACCOUNT,
      diagramId,
      edit: validEdit(),
    });

    expect(result.report.valid).toBe(true);
    expect(result.snapshot.version.diagramId).toBe(diagramId);
    // Metadata persisted, keyed by element id, carrying attributes.
    const tags = result.snapshot.metadata
      .filter((m) => m.equipmentType === "collection-tank")
      .map((m) => m.attributes.tag);
    expect(tags.sort()).toEqual(["TK-101", "TK-102"]);

    // It actually landed: a new version exists in history.
    const versions = await service.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions.map((v) => v.id)).toContain(result.snapshot.version.id);
  });

  it("appends a distinct immutable version per commit", async () => {
    const first = await pipeline.commit({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    const second = await pipeline.commit({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    expect(second.snapshot.version.id).not.toBe(first.snapshot.version.id);
    const versions = await service.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions.length).toBe(2);
  });

  it("blocks the commit and surfaces the report when validation fails", async () => {
    const edit = validEdit();
    // Break it: orphan the connection's target endpoint (rule b).
    edit.connections = [
      { elementId: "line-1", sourceElementId: "tank-a", targetElementId: null },
    ];

    await expect(
      pipeline.commit({ accountId: ACCOUNT, diagramId, edit }),
    ).rejects.toBeInstanceOf(CommitBlockedError);

    let captured: CommitBlockedError | undefined;
    try {
      await pipeline.commit({ accountId: ACCOUNT, diagramId, edit });
    } catch (error) {
      captured = error as CommitBlockedError;
    }
    expect(captured?.report.valid).toBe(false);
    expect(captured?.report.errors.some((e) => e.code === "endpoint-unbound")).toBe(true);

    // Nothing persisted — no second write path past a failed validate.
    const versions = await service.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions).toEqual([]);
  });

  it("blocks on a missing required attribute and persists nothing", async () => {
    const edit = validEdit();
    edit.elements = edit.elements.map((el) =>
      el.id === "tank-a" ? { ...el, attributes: {} } : el,
    );

    await expect(
      pipeline.commit({ accountId: ACCOUNT, diagramId, edit }),
    ).rejects.toMatchObject({ name: "CommitBlockedError" });

    const versions = await service.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions).toEqual([]);
  });

  it("rejects an unknown equipment type at the boundary", async () => {
    const edit = validEdit();
    edit.elements = [
      { id: "x", equipmentType: "not-a-symbol", portIds: [], attributes: {} },
    ];
    await expect(
      pipeline.commit({ accountId: ACCOUNT, diagramId, edit }),
    ).rejects.toBeInstanceOf(DiagramError);
  });

  it("does not commit to a diagram owned by another account", async () => {
    await expect(
      pipeline.commit({ accountId: OTHER_ACCOUNT, diagramId, edit: validEdit() }),
    ).rejects.toMatchObject({ name: "DiagramError", code: "not_found" });
  });

  it("a CommitBlockedError reports the same shape the validator produced", async () => {
    const edit = validEdit();
    edit.connections = [
      { elementId: "line-1", sourceElementId: null, targetElementId: null },
    ];
    const expected = createConnectivityValidator().validate({
      elements: edit.elements.map((e) => ({
        id: e.id,
        equipmentType: asSymbolId(e.equipmentType),
        portIds: e.portIds,
      })),
      connections: edit.connections,
      metadata: edit.elements.map((e) => ({
        diagramVersionId: "00000000-0000-0000-0000-000000000000",
        elementId: e.id,
        equipmentType: asSymbolId(e.equipmentType),
        attributes: e.attributes,
      })),
    });

    let captured: CommitBlockedError | undefined;
    try {
      await pipeline.commit({ accountId: ACCOUNT, diagramId, edit });
    } catch (error) {
      captured = error as CommitBlockedError;
    }
    expect(captured?.report).toEqual(expected);
  });
});
