/**
 * Proposal lifecycle tests (DEV-1144 — tests-first, the high-blast-radius
 * primitive per CLAUDE.md). Covers the full lifecycle: stage → accept (re-validate
 * + commit through the single pipeline) and stage → reject (discard), plus
 * invalid-on-stage refusal, invalid-on-accept (canonical drift), tenant scope,
 * and terminal-status guards.
 *
 * The service is wired over the REAL commit pipeline + diagram service so the
 * "one committer / accept routes through the pipeline" invariant is exercised
 * end to end, not mocked.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { CommitBlockedError, DiagramCommitPipeline } from "@/lib/diagram/commit";
import { DiagramService, InMemoryDiagramRepository } from "@/lib/diagram";
import type { JsonObject } from "@/lib/types";
import { jsonObjectSchema } from "@/lib/types";
import { createConnectivityValidator } from "@/lib/validator";
import { InMemoryProposalRepository } from "./in-memory-repository";
import { ProposalService } from "./service";
import { ProposalError } from "./types";
import type { StageProposalInput } from "./types";

const ACCOUNT = crypto.randomUUID();
const OTHER_ACCOUNT = crypto.randomUUID();

const SCENE: JsonObject = { type: "excalidraw", elements: [], appState: {} };

/** A connected, fully-attributed two-tank edit that passes the v1 validator. */
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

describe("ProposalService lifecycle", () => {
  let proposals: InMemoryProposalRepository;
  let diagramRepo: InMemoryDiagramRepository;
  let diagramService: DiagramService;
  let pipeline: DiagramCommitPipeline;
  let service: ProposalService;
  let diagramId: string;

  beforeEach(async () => {
    proposals = new InMemoryProposalRepository();
    diagramRepo = new InMemoryDiagramRepository();
    diagramService = new DiagramService(diagramRepo);
    pipeline = new DiagramCommitPipeline(diagramService, createConnectivityValidator());
    service = new ProposalService(
      proposals,
      pipeline,
      createConnectivityValidator(),
      diagramRepo,
    );
    const diagram = await diagramService.create({ accountId: ACCOUNT, name: "Rig" });
    diagramId = diagram.id;
  });

  // --- staging (FR-7, FR-8) ---------------------------------------------------

  it("stages a valid proposal as pending and persists nothing to canonical state", async () => {
    const proposal = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });

    expect(proposal.status).toBe("pending");
    expect(proposal.diagramId).toBe(diagramId);
    // staged_change carries the exact edit; validator_report says valid.
    expect((proposal.stagedChange as { edit: unknown }).edit).toBeDefined();
    expect((proposal.validatorReport as { valid: boolean }).valid).toBe(true);

    // Staging is NOT a commit: no version was written.
    const versions = await diagramService.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions).toEqual([]);

    // It is visible as pending.
    const pending = await service.listPending({ accountId: ACCOUNT, diagramId });
    expect(pending.map((p) => p.id)).toEqual([proposal.id]);
  });

  it("refuses to stage an invalid proposal (orphan connection) and writes no row (FR-8)", async () => {
    const edit = validEdit();
    edit.connections = [
      { elementId: "line-1", sourceElementId: "tank-a", targetElementId: null },
    ];

    let captured: ProposalError | undefined;
    try {
      await service.stage({ accountId: ACCOUNT, diagramId, edit });
    } catch (error) {
      captured = error as ProposalError;
    }
    expect(captured?.code).toBe("invalid_proposal");
    // The validator report rides along so an MCP tool can hand reasons to Claude.
    const report = captured?.report as { valid: boolean; errors: { code: string }[] };
    expect(report.valid).toBe(false);
    expect(report.errors.some((e) => e.code === "endpoint-unbound")).toBe(true);

    // Nothing staged.
    const pending = await service.listPending({ accountId: ACCOUNT, diagramId });
    expect(pending).toEqual([]);
  });

  it("refuses to stage a duplicate-tag proposal (FR-8)", async () => {
    const edit = validEdit();
    edit.elements = edit.elements.map((el) =>
      el.id === "tank-b" ? { ...el, attributes: { tag: "TK-101", volume: "200L" } } : el,
    );
    await expect(
      service.stage({ accountId: ACCOUNT, diagramId, edit }),
    ).rejects.toMatchObject({ code: "invalid_proposal" });
  });

  it("rejects an unknown equipment type at the staging boundary", async () => {
    const edit = validEdit();
    edit.elements = [{ id: "x", equipmentType: "not-a-symbol", portIds: [], attributes: {} }];
    await expect(
      service.stage({ accountId: ACCOUNT, diagramId, edit }),
    ).rejects.toMatchObject({ name: "ProposalError", code: "invalid_input" });
  });

  it("will not stage against a diagram owned by another account", async () => {
    await expect(
      service.stage({ accountId: OTHER_ACCOUNT, diagramId, edit: validEdit() }),
    ).rejects.toMatchObject({ name: "ProposalError", code: "not_found" });
  });

  // --- accept (FR-10) ---------------------------------------------------------

  it("accept re-validates then commits through the single pipeline and marks accepted", async () => {
    const staged = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });

    const result = await service.accept({ accountId: ACCOUNT, diagramId, proposalId: staged.id });

    expect(result.proposal.status).toBe("accepted");
    expect(result.commit.report.valid).toBe(true);
    expect(result.commit.snapshot.version.diagramId).toBe(diagramId);

    // The commit landed as a real immutable version (committed via the pipeline).
    const versions = await diagramService.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions.map((v) => v.id)).toContain(result.commit.snapshot.version.id);

    // No longer pending.
    const pending = await service.listPending({ accountId: ACCOUNT, diagramId });
    expect(pending).toEqual([]);
  });

  it("blocks accept when the staged edit no longer validates (canonical drift) and persists nothing", async () => {
    // Stage a valid proposal, then tamper the persisted staged edit to be invalid,
    // simulating a change that fails on the accept-time re-validation.
    const staged = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    const tampered = JSON.parse(JSON.stringify(staged.stagedChange)) as {
      edit: { connections: { elementId: string; sourceElementId: string | null; targetElementId: string | null }[] };
    };
    tampered.edit.connections = [
      { elementId: "line-1", sourceElementId: "tank-a", targetElementId: null },
    ];
    // Re-stage by hand through the repository to plant the invalid edit on a
    // pending row (bypassing the staging gate, which would have refused it).
    const planted = await proposals.create({
      diagramId,
      stagedChange: jsonObjectSchema.parse(tampered),
      validatorReport: { valid: true, errors: [] },
    });

    await expect(
      service.accept({ accountId: ACCOUNT, diagramId, proposalId: planted.id }),
    ).rejects.toBeInstanceOf(CommitBlockedError);

    // Nothing committed.
    const versions = await diagramService.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions).toEqual([]);

    // And — critically — the proposal is NOT left falsely `accepted` with nothing
    // committed. A blocked accept compensates the status claim back to `pending`
    // (no silent data loss); the change is recoverable, not gone.
    const after = await proposals.get({ accountId: ACCOUNT, diagramId, proposalId: planted.id });
    expect(after?.status).toBe("pending");
  });

  it("a blocked accept stays pending and can be retried once the blocker clears", async () => {
    // Stage a valid proposal, then make its FIRST commit fail to model a dependency
    // that isn't committed yet; the second commit (after the blocker clears)
    // succeeds. The proposal must survive the first failure as `pending`.
    const staged = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });

    let failNext = true;
    const flaky = {
      commit: (args: Parameters<DiagramCommitPipeline["commit"]>[0]) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(
            new CommitBlockedError({
              valid: false,
              errors: [
                {
                  code: "endpoint-missing-element",
                  elementId: "line-1",
                  message: "endpoint not committed yet",
                },
              ],
            }),
          );
        }
        return pipeline.commit(args);
      },
    } as unknown as DiagramCommitPipeline;
    const flakyService = new ProposalService(
      proposals,
      flaky,
      createConnectivityValidator(),
      diagramRepo,
    );

    // First accept fails — but leaves the proposal pending (compensated), not accepted.
    await expect(
      flakyService.accept({ accountId: ACCOUNT, diagramId, proposalId: staged.id }),
    ).rejects.toBeInstanceOf(CommitBlockedError);
    expect(
      (await proposals.get({ accountId: ACCOUNT, diagramId, proposalId: staged.id }))?.status,
    ).toBe("pending");

    // Retry now succeeds and commits exactly one version.
    const result = await flakyService.accept({ accountId: ACCOUNT, diagramId, proposalId: staged.id });
    expect(result.proposal.status).toBe("accepted");
    const versions = await diagramService.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions).toHaveLength(1);
  });

  it("cannot accept a proposal twice (terminal-status guard)", async () => {
    const staged = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    await service.accept({ accountId: ACCOUNT, diagramId, proposalId: staged.id });

    await expect(
      service.accept({ accountId: ACCOUNT, diagramId, proposalId: staged.id }),
    ).rejects.toMatchObject({ name: "ProposalError", code: "not_pending" });
  });

  it("will not accept a proposal on a diagram owned by another account", async () => {
    const staged = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    await expect(
      service.accept({ accountId: OTHER_ACCOUNT, diagramId, proposalId: staged.id }),
    ).rejects.toMatchObject({ name: "ProposalError", code: "not_found" });
  });

  // --- reject (FR-10) ---------------------------------------------------------

  it("reject discards cleanly: marks rejected, commits nothing", async () => {
    const staged = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });

    const rejected = await service.reject({ accountId: ACCOUNT, diagramId, proposalId: staged.id });
    expect(rejected.status).toBe("rejected");

    const versions = await diagramService.listVersions({ accountId: ACCOUNT, diagramId });
    expect(versions).toEqual([]);

    const pending = await service.listPending({ accountId: ACCOUNT, diagramId });
    expect(pending).toEqual([]);
  });

  it("cannot reject an already-accepted proposal, nor accept an already-rejected one", async () => {
    const a = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    await service.accept({ accountId: ACCOUNT, diagramId, proposalId: a.id });
    await expect(
      service.reject({ accountId: ACCOUNT, diagramId, proposalId: a.id }),
    ).rejects.toMatchObject({ code: "not_pending" });

    const b = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    await service.reject({ accountId: ACCOUNT, diagramId, proposalId: b.id });
    await expect(
      service.accept({ accountId: ACCOUNT, diagramId, proposalId: b.id }),
    ).rejects.toMatchObject({ code: "not_pending" });
  });

  it("reports not_found when deciding a proposal that does not exist", async () => {
    await expect(
      service.reject({ accountId: ACCOUNT, diagramId, proposalId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  // --- multi-proposal listing -------------------------------------------------

  it("lists only pending proposals, newest first; decided ones drop out", async () => {
    const first = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    const second = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });
    const third = await service.stage({ accountId: ACCOUNT, diagramId, edit: validEdit() });

    await service.reject({ accountId: ACCOUNT, diagramId, proposalId: second.id });

    const pending = await service.listPending({ accountId: ACCOUNT, diagramId });
    expect(pending.map((p) => p.id)).toEqual([third.id, first.id]);
  });
});
