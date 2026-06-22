/**
 * Delta-based, pending-aware proposal tests (no-clobber fix).
 *
 * The propose tools store the DELTA (op) on each proposal and stage against the
 * EFFECTIVE scene (committed + all pending ops). Acceptance re-materializes the
 * stored op against CURRENT committed state. This file proves the exact scenarios
 * the fix targets:
 *
 *   - multi-step staging: add A, add B, connect A↔B all stage (the connect sees
 *     the two pending, uncommitted elements);
 *   - NO CLOBBER: accept add-A then accept add-B → committed has BOTH (the
 *     user-reported bug — accepting B used to erase A);
 *   - get_active_diagram returns committed + pending (a staged-but-uncommitted
 *     element is visible with its port ids);
 *   - out-of-order accept (connect before its equipment is committed) is BLOCKED
 *     by re-validation — nothing committed;
 *   - reject drops a pending op; the others' effective state recomputes without it.
 *
 * Everything runs over the in-memory diagram + proposal repositories, wired the
 * way the composition root (`registerMcpTools`) wires production: one shared
 * active-diagram source + one proposal service carrying the accept materializer.
 */
import { describe, expect, it } from "vitest";
import type { TransportContext } from "@/lib/claude-transport";
import {
  DiagramService,
  InMemoryDiagramRepository,
} from "@/lib/diagram";
import { DiagramCommitPipeline } from "@/lib/diagram/commit";
import {
  InMemoryProposalRepository,
  ProposalService,
} from "@/lib/proposals";
import { createConnectivityValidator } from "@/lib/validator";
import { DiagramServiceActiveSource } from "./active-diagram-source";
import { McpProposeTools } from "./propose-tools";
import { createMaterializeEdit } from "./propose-index";
import { McpReadTools } from "./tools";
import { createPendingOpsProvider } from "./index";
import type { EquipmentState } from "./canonical-state";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";

interface Harness {
  diagrams: DiagramService;
  proposals: ProposalService;
  proposalRepo: InMemoryProposalRepository;
  tools: McpProposeTools;
  readTools: McpReadTools;
  diagramId: string;
}

/** Build the in-memory stack the production way: shared source + a proposal
 * service with the accept-time materializer; read tools with the pending overlay.
 * The diagram starts EMPTY (no committed version) — the realistic first-draft. */
async function harness(): Promise<Harness> {
  const repo = new InMemoryDiagramRepository();
  const diagrams = new DiagramService(repo);
  const pipeline = new DiagramCommitPipeline(
    diagrams,
    createConnectivityValidator(),
  );
  const proposalRepo = new InMemoryProposalRepository();
  const source = new DiagramServiceActiveSource(diagrams);
  const proposals = new ProposalService(
    proposalRepo,
    pipeline,
    createConnectivityValidator(),
    repo,
    createMaterializeEdit(source),
  );
  const tools = new McpProposeTools(source, proposals);
  const readTools = new McpReadTools(
    source,
    createConnectivityValidator(),
    createPendingOpsProvider(proposals),
  );

  const diagram = await diagrams.create({ accountId: ACCOUNT, name: "Skid" });
  return { diagrams, proposals, proposalRepo, tools, readTools, diagramId: diagram.id };
}

function context(diagramId: string, accountId = ACCOUNT): TransportContext {
  return { accountId, activeDiagramId: diagramId };
}

/** Find a staged-state equipment row by its tag. */
function byTag(
  equipment: readonly EquipmentState[],
  tag: string,
): EquipmentState {
  const found = equipment.find((e) => e.tag === tag);
  if (found === undefined) {
    throw new Error(`No equipment with tag ${tag} in ${JSON.stringify(equipment.map((e) => e.tag))}`);
  }
  return found;
}

/** Stage an `add_equipment` and return the new element's id (resolved by tag). */
async function addTank(
  h: Harness,
  tag: string,
  x: number,
): Promise<{ proposalId: string; elementId: string }> {
  const result = await h.tools.addEquipment(context(h.diagramId), {
    equipmentType: "collection-tank",
    x,
    y: 40,
    attributes: { tag, volume: "200L" },
  });
  expect(result.status).toBe("staged");
  if (result.status !== "staged") throw new Error("not staged");
  return { proposalId: result.proposalId, elementId: byTag(result.state.equipment, tag).elementId };
}

/** Count committed versions. */
async function versionCount(h: Harness): Promise<number> {
  return (await h.diagrams.listVersions({ accountId: ACCOUNT, diagramId: h.diagramId })).length;
}

describe("delta proposals — multi-step staging (pending-aware)", () => {
  it("stages add C-101, add T-101, then connect C-101↔T-101 (connect sees both pendings)", async () => {
    const h = await harness();

    const c = await addTank(h, "C-101", 60);
    const t = await addTank(h, "T-101", 300);

    // The connect references elements that exist ONLY as pending proposals — no
    // committed version has them yet. The effective scene (committed + pending)
    // makes them resolvable, so the connect STAGES rather than being refused.
    const conn = await h.tools.connect(context(h.diagramId), {
      sourceElementId: c.elementId,
      sourcePort: "right",
      targetElementId: t.elementId,
      targetPort: "left",
      lineId: "L-1",
      attributes: { service: "transfer" },
    });

    expect(conn.status).toBe("staged");
    if (conn.status !== "staged") return;
    // The staged effective state shows both tanks and the new line.
    expect(conn.state.equipment.map((e) => e.tag).sort()).toEqual(["C-101", "T-101"]);
    expect(conn.state.connections).toHaveLength(1);

    // Three pending proposals, nothing committed (one committer).
    const pending = await h.proposalRepo.listPending({ accountId: ACCOUNT, diagramId: h.diagramId });
    expect(pending).toHaveLength(3);
    expect(await versionCount(h)).toBe(0);
  });
});

describe("delta proposals — accept never clobbers a prior commit", () => {
  it("accept add-C-101 then accept add-T-101 → committed version has BOTH", async () => {
    const h = await harness();

    const c = await addTank(h, "C-101", 60);
    const t = await addTank(h, "T-101", 300);

    // Accept C-101: committed = [C-101].
    await h.proposals.accept({ accountId: ACCOUNT, diagramId: h.diagramId, proposalId: c.proposalId });
    // Accept T-101: the delta is re-materialized against the NOW-committed [C-101],
    // so committed = [C-101, T-101] — T-101 does not erase C-101 (the bug).
    const accepted = await h.proposals.accept({
      accountId: ACCOUNT,
      diagramId: h.diagramId,
      proposalId: t.proposalId,
    });

    // Assert the committed VERSION content (the user-reported bug surface).
    const tags = accepted.commit.snapshot.metadata
      .map((m) => (m.attributes as { tag?: string }).tag)
      .filter((v): v is string => typeof v === "string")
      .sort();
    expect(tags).toEqual(["C-101", "T-101"]);
    expect(await versionCount(h)).toBe(2); // two commits, each appending a version
  });
});

describe("delta proposals — get_active_diagram returns committed + pending", () => {
  it("shows a staged-but-uncommitted element with its port ids", async () => {
    const h = await harness();
    await addTank(h, "C-101", 60); // staged only — never accepted

    const view = await h.readTools.getActiveDiagram(context(h.diagramId));
    const tank = view.equipment.find((e) => e.tag === "C-101");
    expect(tank).toBeDefined();
    expect(tank?.equipmentType).toBe("collection-tank");

    // The pending element is visible AND addressable: a subsequent connect can
    // name a real port on it (proven by staging a connect to a second pending).
    const t = await addTank(h, "T-101", 300);
    const conn = await h.tools.connect(context(h.diagramId), {
      sourceElementId: tank!.elementId,
      sourcePort: "right",
      targetElementId: t.elementId,
      targetPort: "left",
      lineId: "L-1",
      attributes: { service: "transfer" },
    });
    expect(conn.status).toBe("staged");
  });
});

describe("delta proposals — out-of-order accept is blocked (re-validation)", () => {
  it("accepting the connect before its equipment is committed commits NOTHING", async () => {
    const h = await harness();

    const c = await addTank(h, "C-101", 60);
    const t = await addTank(h, "T-101", 300);
    const conn = await h.tools.connect(context(h.diagramId), {
      sourceElementId: c.elementId,
      sourcePort: "right",
      targetElementId: t.elementId,
      targetPort: "left",
      lineId: "L-1",
      attributes: { service: "transfer" },
    });
    expect(conn.status).toBe("staged");
    if (conn.status !== "staged") return;

    // Accept the CONNECT first. Its delta materializes against EMPTY committed
    // state (the equipment is not committed yet), so the endpoints are missing →
    // the commit pipeline's re-validation BLOCKS it.
    await expect(
      h.proposals.accept({ accountId: ACCOUNT, diagramId: h.diagramId, proposalId: conn.proposalId }),
    ).rejects.toMatchObject({ name: "CommitBlockedError" });

    // Nothing was committed.
    expect(await versionCount(h)).toBe(0);
  });
});

describe("delta proposals — reject drops a pending op", () => {
  it("rejecting one pending op removes it from the others' effective state", async () => {
    const h = await harness();

    await addTank(h, "C-101", 60);
    const t = await addTank(h, "T-101", 300);

    // Before reject: effective state shows both.
    const before = await h.readTools.getActiveDiagram(context(h.diagramId));
    expect(before.equipment.map((e) => e.tag).sort()).toEqual(["C-101", "T-101"]);

    // Reject T-101.
    await h.proposals.reject({ accountId: ACCOUNT, diagramId: h.diagramId, proposalId: t.proposalId });

    // Effective state recomputes WITHOUT the rejected op — only C-101 remains.
    const after = await h.readTools.getActiveDiagram(context(h.diagramId));
    expect(after.equipment.map((e) => e.tag)).toEqual(["C-101"]);

    // A new op stages against the post-reject effective scene (one pending).
    const pending = await h.proposalRepo.listPending({ accountId: ACCOUNT, diagramId: h.diagramId });
    expect(pending).toHaveLength(1);
  });
});
