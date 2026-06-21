// Editor server-action tests (this task: wire /editor to a real diagram).
//
// Covers the three actions the canvas drives:
//   - loadActiveDiagram: no-active-diagram path; loads the latest committed
//     version's model (geometry + re-attached metadata) for the active diagram.
//   - commitDiagramEdit: routes a manual edit through the SINGLE commit pipeline
//     (a valid model persists a new version; an invalid one surfaces validation
//     errors and persists nothing — the human is the sole committer, gate holds).
//   - listPendingProposals: returns the active diagram's PENDING proposals shaped
//     for the overlay; null active diagram → empty.
//
// The account comes from the SESSION; we mock `requireUser` to a fixed account and
// `next/cache` revalidation (no Next runtime under vitest). All services resolve to
// the shared in-memory repositories (NODE_ENV is not "production"), so seeding
// through one service is visible to the action under test — exactly the wiring the
// route uses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCOUNT = "11111111-1111-1111-1111-111111111111";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: vi.fn(async () => ({ accountId: ACCOUNT, email: "a@b.c" })),
}));

import { requireUser } from "@/lib/auth/current-user";
import { getDiagramService } from "@/lib/diagram";
import { getScopingService } from "@/lib/scoping";
import { getProposalService } from "@/lib/proposals";
import {
  commitDiagramEdit,
  loadActiveDiagram,
} from "./editor-actions";
import { listPendingProposals } from "./proposal-actions";
import {
  placementModelToEdit,
  type PlacementModel,
} from "@/components/canvas/placement-model";

/** Force the action's `requireUser` to a specific account (tenant isolation). */
function signInAs(accountId: string): void {
  vi.mocked(requireUser).mockResolvedValue({
    accountId,
    email: "a@b.c",
  });
}

/** A valid single-tank model (passes v1 connectivity — no edges, attributed). */
function validModel(): PlacementModel {
  return {
    nodes: [
      {
        elementId: "tank-1",
        symbolId: "collection-tank",
        x: 40,
        y: 40,
        size: 100,
        attributes: { tag: "TK-101", volume: "200L" },
      },
    ],
    edges: [],
    viewport: { width: 400, height: 400 },
  };
}

/** A model whose tank is missing its required `volume` attribute → gate-blocked. */
function invalidModel(): PlacementModel {
  return {
    nodes: [
      {
        elementId: "tank-1",
        symbolId: "collection-tank",
        x: 40,
        y: 40,
        size: 100,
        attributes: { tag: "TK-101" },
      },
    ],
    edges: [],
    viewport: { width: 400, height: 400 },
  };
}

async function seedActiveDiagram(name = "P&ID"): Promise<string> {
  const diagram = await getDiagramService().create({ accountId: ACCOUNT, name });
  await getScopingService().setActiveDiagram({
    accountId: ACCOUNT,
    diagramId: diagram.id,
  });
  return diagram.id;
}

beforeEach(async () => {
  signInAs(ACCOUNT);
  // Clear any active selection leaked from a prior test (shared singleton repo).
  await getScopingService().clearActiveDiagram(ACCOUNT);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadActiveDiagram", () => {
  it("reports no-active-diagram when the account has none", async () => {
    const result = await loadActiveDiagram();
    expect(result.status).toBe("no-active-diagram");
  });

  it("loads an empty model for an active diagram with no saved version", async () => {
    await seedActiveDiagram();
    const result = await loadActiveDiagram();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.diagram.versionId).toBeNull();
    expect(result.diagram.model.nodes).toEqual([]);
  });

  it("loads the latest committed version's model (metadata re-attached by id)", async () => {
    const diagramId = await seedActiveDiagram();
    await getDiagramService().save({
      accountId: ACCOUNT,
      diagramId,
      // Persist directly through the same service the pipeline uses, with a
      // pid-bearing scene so the load projects geometry + attributes back.
      save: (() => {
        const edit = placementModelToEdit(validModel());
        return {
          excalidrawScene: edit.scene,
          metadata: edit.elements.map((e) => ({
            elementId: e.id,
            equipmentType: e.equipmentType,
            attributes: e.attributes,
          })),
        };
      })(),
    });

    const result = await loadActiveDiagram();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.diagram.versionId).not.toBeNull();
    expect(result.diagram.model.nodes).toHaveLength(1);
    expect(result.diagram.model.nodes[0]?.attributes.tag).toBe("TK-101");
  });
});

describe("commitDiagramEdit", () => {
  it("commits a valid model as a new version through the pipeline", async () => {
    await seedActiveDiagram();
    const result = await commitDiagramEdit(validModel());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.versionId).toBeTruthy();

    // The committed version is now the latest the editor reloads.
    const loaded = await loadActiveDiagram();
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.diagram.versionId).toBe(result.versionId);
  });

  it("blocks an invalid model and surfaces validation errors (persists nothing)", async () => {
    await seedActiveDiagram();
    const result = await commitDiagramEdit(invalidModel());
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.validationErrors?.length).toBeGreaterThan(0);

    // Gate held: no version was persisted.
    const loaded = await loadActiveDiagram();
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    expect(loaded.diagram.versionId).toBeNull();
  });

  it("reports no-active-diagram when nothing is active", async () => {
    const result = await commitDiagramEdit(validModel());
    expect(result.status).toBe("no-active-diagram");
  });
});

describe("listPendingProposals", () => {
  it("returns no active diagram + empty list when none is active", async () => {
    const result = await listPendingProposals();
    expect(result.activeDiagramId).toBeNull();
    expect(result.proposals).toEqual([]);
  });

  it("lists the active diagram's pending proposals shaped for the overlay", async () => {
    const diagramId = await seedActiveDiagram();
    // Stage a valid proposal directly through the lifecycle (as the MCP tool would).
    const edit = placementModelToEdit(validModel());
    await getProposalService().stage({
      accountId: ACCOUNT,
      diagramId,
      edit,
    });

    const result = await listPendingProposals();
    expect(result.activeDiagramId).toBe(diagramId);
    expect(result.proposals).toHaveLength(1);
    // The overlay needs a diff with the proposed element ghosted.
    expect(result.proposals[0]?.diff.proposedEquipment.length).toBeGreaterThan(0);
  });
});
