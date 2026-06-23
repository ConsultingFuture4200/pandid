// Multi-tenant isolation review + tests (DEV-1158, SC-3).
//
// Proves a tenant cannot read or write another tenant's data across EVERY
// account-scoped data path — diagrams, immutable versions + their element
// metadata, proposals, and active-diagram scoping. The services are wired over
// the real in-memory repositories (the same scope contract the Postgres repos
// enforce via account joins), so the isolation is exercised end to end, not
// mocked. A regression that drops an account check anywhere here fails this file.

import { beforeEach, describe, expect, it } from "vitest";

import {
  DiagramService,
  DiagramError,
  InMemoryDiagramRepository,
} from "@/lib/diagram";
import { DiagramCommitPipeline } from "@/lib/diagram/commit";
import { createConnectivityValidator } from "@/lib/validator";
import {
  ProposalService,
  ProposalError,
  InMemoryProposalRepository,
} from "@/lib/proposals";
import {
  ScopingService,
  ScopingError,
  InMemoryScopingRepository,
} from "@/lib/scoping";
import type { JsonObject } from "@/lib/types";
import type { StageProposalInput } from "@/lib/proposals/types";

const TENANT_A = crypto.randomUUID();
const TENANT_B = crypto.randomUUID();

const SCENE: JsonObject = { type: "excalidraw", elements: [], appState: {} };

/** A valid two-tank edit (passes the v1 validator) for staging/saving. */
function validEdit(): StageProposalInput["edit"] {
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
      { elementId: "line-1", sourceElementId: "tank-a", targetElementId: "tank-b" },
    ],
  };
}

describe("multi-tenant isolation (DEV-1158)", () => {
  let diagramRepo: InMemoryDiagramRepository;
  let diagrams: DiagramService;
  let proposals: ProposalService;
  let scoping: ScopingService;
  let aDiagramId: string;

  beforeEach(async () => {
    diagramRepo = new InMemoryDiagramRepository();
    diagrams = new DiagramService(diagramRepo);
    const pipeline = new DiagramCommitPipeline(
      diagrams,
      createConnectivityValidator(),
    );
    proposals = new ProposalService(
      new InMemoryProposalRepository(),
      pipeline,
      createConnectivityValidator(),
      diagramRepo,
    );
    scoping = new ScopingService(
      new InMemoryScopingRepository(diagramRepo),
      diagrams,
    );

    // Tenant A owns a saved diagram.
    const a = await diagrams.create({ accountId: TENANT_A, name: "A-rig" });
    aDiagramId = a.id;
    await diagrams.save({
      accountId: TENANT_A,
      diagramId: aDiagramId,
      save: {
        excalidrawScene: SCENE,
        metadata: [
          {
            elementId: "tank-a",
            equipmentType: "collection-tank",
            attributes: { tag: "SECRET-TAG", volume: "200L" },
          },
        ],
      },
    });
  });

  // --- diagrams + versions + metadata ----------------------------------------

  it("Tenant B cannot list, open, restore, rename, or delete Tenant A's diagram", async () => {
    // List is account-scoped — B sees nothing of A's.
    expect(await diagrams.list(TENANT_B)).toHaveLength(0);
    expect(await diagrams.list(TENANT_A)).toHaveLength(1);

    // Open / version-list / restore / rename / delete all deny cross-tenant.
    await expect(
      diagrams.open({ accountId: TENANT_B, diagramId: aDiagramId }),
    ).rejects.toMatchObject({ name: "DiagramError", code: "not_found" });
    await expect(
      diagrams.listVersions({ accountId: TENANT_B, diagramId: aDiagramId }),
    ).rejects.toBeInstanceOf(DiagramError);
    await expect(
      diagrams.rename({ accountId: TENANT_B, diagramId: aDiagramId, name: "hijack" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      diagrams.delete({ accountId: TENANT_B, diagramId: aDiagramId }),
    ).rejects.toMatchObject({ code: "not_found" });

    // A's diagram is untouched (still openable by A, name unchanged).
    const opened = await diagrams.open({ accountId: TENANT_A, diagramId: aDiagramId });
    expect(opened.diagram.name).toBe("A-rig");
  });

  it("Tenant B cannot read Tenant A's version metadata (SECRET-TAG never leaks)", async () => {
    const { versions } = await diagrams.open({
      accountId: TENANT_A,
      diagramId: aDiagramId,
    });
    const versionId = versions[0].id;

    // Restoring the version (which carries the metadata) is account-scoped.
    await expect(
      diagrams.restoreVersion({
        accountId: TENANT_B,
        diagramId: aDiagramId,
        versionId,
      }),
    ).rejects.toMatchObject({ name: "DiagramError", code: "not_found" });

    // A can read it; the secret tag is present only for the owner.
    const snapshot = await diagrams.restoreVersion({
      accountId: TENANT_A,
      diagramId: aDiagramId,
      versionId,
    });
    expect(snapshot.metadata.map((m) => m.attributes.tag)).toContain("SECRET-TAG");
  });

  // --- proposals --------------------------------------------------------------

  it("Tenant B cannot stage, list, accept, or reject proposals on Tenant A's diagram", async () => {
    // Stage as A → a real pending proposal exists on A's diagram.
    const staged = await proposals.stage({
      accountId: TENANT_A,
      diagramId: aDiagramId,
      edit: validEdit(),
    });

    // B can't stage onto A's diagram (ownership check → not_found).
    await expect(
      proposals.stage({
        accountId: TENANT_B,
        diagramId: aDiagramId,
        edit: validEdit(),
      }),
    ).rejects.toMatchObject({ name: "ProposalError", code: "not_found" });

    // B can't see A's pending proposals.
    expect(
      await proposals.listPending({ accountId: TENANT_B, diagramId: aDiagramId }),
    ).toHaveLength(0);
    expect(
      await proposals.listPending({ accountId: TENANT_A, diagramId: aDiagramId }),
    ).toHaveLength(1);

    // B can't accept or reject A's proposal (scoped → not_found, never committed).
    await expect(
      proposals.accept({
        accountId: TENANT_B,
        diagramId: aDiagramId,
        proposalId: staged.id,
      }),
    ).rejects.toBeInstanceOf(ProposalError);
    await expect(
      proposals.reject({
        accountId: TENANT_B,
        diagramId: aDiagramId,
        proposalId: staged.id,
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    // A's proposal survived B's attempts (still pending).
    const stillPending = await proposals.listPending({
      accountId: TENANT_A,
      diagramId: aDiagramId,
    });
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0].status).toBe("pending");
  });

  // --- active-diagram scoping -------------------------------------------------

  it("active-diagram scoping is per-account and cannot bind another tenant's diagram", async () => {
    // B cannot make A's diagram its active diagram (ownership check first).
    await expect(
      scoping.setActiveDiagram({ accountId: TENANT_B, diagramId: aDiagramId }),
    ).rejects.toBeInstanceOf(ScopingError);

    // A activates its own diagram; B's active diagram stays null (independent).
    await scoping.setActiveDiagram({ accountId: TENANT_A, diagramId: aDiagramId });
    expect((await scoping.getActiveDiagram(TENANT_A))?.id).toBe(aDiagramId);
    expect(await scoping.getActiveDiagram(TENANT_B)).toBeNull();
  });
});
