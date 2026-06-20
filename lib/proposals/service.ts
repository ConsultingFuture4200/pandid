/**
 * Proposal lifecycle service (DEV-1144, PRD §5.2 / §8, FR-7,8,10).
 *
 * The heart of the "reliably by construction" claim (PRD §8): a single committer
 * and a validator that gates BOTH staging and acceptance.
 *
 *   stage   → validate the proposed edit; refuse to stage if invalid (FR-8);
 *             else write a `pending` proposal row. Canonical state is untouched.
 *   accept  → flip pending→accepted, then RE-VALIDATE and commit the staged edit
 *             through the SAME commit pipeline a manual edit uses (DEV-1140).
 *             No second persist path (CLAUDE.md: one committer).
 *   reject  → flip pending→rejected and discard. Nothing is committed.
 *
 * Architecture invariants upheld:
 *   - Proposals are STAGED, never applied — only `accept` reaches canonical state,
 *     and only via the commit pipeline.
 *   - One committer — acceptance routes through `DiagramCommitPipeline.commit`;
 *     the proposal layer never persists a version itself.
 *   - Validator behind an interface — staging validates through the injected
 *     `Validator`; acceptance re-validates inside the pipeline. Both share the v1
 *     connectivity validator, so a proposal that fails validation cannot commit
 *     from either gate.
 *   - Versions are immutable — the pipeline appends; this layer never mutates one.
 */
import { isSymbolId, type SymbolId } from "@/lib/symbols";
import type { DiagramCommitPipeline } from "@/lib/diagram/commit";
import type { Connection, Proposal } from "@/lib/types";
import type {
  DiagramSnapshot,
  ValidationReport,
  Validator,
} from "@/lib/validator";
import type { DiagramRepository } from "@/lib/diagram";
import { jsonObjectSchema, type JsonObject } from "@/lib/types";
import type { ProposalRepository } from "./repository";
import { InMemoryProposalRepository } from "./in-memory-repository";
import {
  ProposalError,
  stageProposalInputSchema,
  type CommitElementLike,
  type DiagramEdit,
  type StageProposalInput,
} from "./types";

/** Sentinel version id used only to satisfy the snapshot's metadata shape during
 * staging-time validation. The validator never reads `diagramVersionId`; the real
 * version id is assigned later by the commit pipeline on accept. Matches the
 * pipeline's own pre-persist sentinel so both gates validate identical snapshots. */
const PRE_PERSIST_VERSION_ID = "00000000-0000-0000-0000-000000000000";

/** A successful acceptance: the (now terminal) proposal + the committed version. */
export interface AcceptResult {
  readonly proposal: Proposal;
  readonly commit: Awaited<ReturnType<DiagramCommitPipeline["commit"]>>;
}

export class ProposalService {
  constructor(
    private readonly repo: ProposalRepository,
    private readonly pipeline: DiagramCommitPipeline,
    private readonly validator: Validator,
    /**
     * Confirms a diagram is owned by the account before any proposal touches it.
     * The lifecycle never bypasses tenant isolation: an unowned diagram has no
     * proposals it can stage, see, or decide.
     */
    private readonly diagrams: Pick<DiagramRepository, "getDiagram">,
  ) {}

  /**
   * Stage a validated proposal (FR-7, FR-8). Validates the proposed edit through
   * the v1 validator; on any error it does NOT write a row — it throws
   * `invalid_proposal` carrying the report so the caller (an MCP tool) returns
   * the reasons to Claude. On success it writes a `pending` proposal.
   *
   * @throws {ProposalError} `invalid_input` (malformed payload / unknown equipment
   *   type), `not_found` (diagram absent or not owned), `invalid_proposal` (the
   *   edit fails validation — nothing staged).
   */
  async stage(input: StageProposalInput): Promise<Proposal> {
    const parsed = this.parseStageInput(input);
    await this.requireOwnedDiagram(parsed.accountId, parsed.diagramId);

    const report = this.validate(parsed.edit);
    if (!report.valid) {
      throw new ProposalError(
        "invalid_proposal",
        `The proposed change can't be staged: it has ${report.errors.length} ` +
          `validation ${report.errors.length === 1 ? "error" : "errors"}. ` +
          "Fix the reported issues and propose again.",
        report,
      );
    }

    return this.repo.create({
      diagramId: parsed.diagramId,
      // Both payloads are JSON-safe by construction (a Zod-parsed edit; a report
      // of JSON primitives). Parse through `jsonObjectSchema` to both prove that
      // at the boundary and produce the `JsonObject` the repository stores.
      stagedChange: this.toJsonObject({ edit: parsed.edit }),
      validatorReport: this.toJsonObject(report),
    });
  }

  /**
   * Accept a pending proposal (FR-10): re-validate and commit the staged edit
   * through the single commit pipeline, then mark the proposal `accepted`.
   *
   * The proposal is flipped to `accepted` FIRST (guarded to `pending`), so a
   * second accept/reject can't race a commit. If the commit then fails — e.g. the
   * canonical diagram drifted since staging and the edit no longer validates —
   * the error propagates; the proposal is left non-pending (decided) and no
   * version was written (the pipeline persists nothing on a blocked commit).
   *
   * @throws {ProposalError} `not_found` (absent / not owned), `not_pending`
   *   (already accepted or rejected).
   * @throws {CommitBlockedError} if re-validation fails on accept (re-thrown from
   *   the pipeline) — nothing is committed.
   */
  async accept(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
  }): Promise<AcceptResult> {
    const decided = await this.decide({ ...input, status: "accepted" });
    const { edit } = this.readStagedEdit(decided);

    const commit = await this.pipeline.commit({
      accountId: input.accountId,
      diagramId: input.diagramId,
      edit,
    });

    return { proposal: decided, commit };
  }

  /**
   * Reject a pending proposal (FR-10): discard it cleanly. Marks it `rejected`
   * and commits nothing — canonical state is untouched.
   *
   * @throws {ProposalError} `not_found` (absent / not owned), `not_pending`
   *   (already decided).
   */
  async reject(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
  }): Promise<Proposal> {
    return this.decide({ ...input, status: "rejected" });
  }

  /** List a diagram's pending proposals for the canvas UI (DEV-1153). */
  async listPending(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Proposal[]> {
    return this.repo.listPending(input);
  }

  /**
   * Flip a pending proposal to a terminal status, atomically and account-scoped.
   * Distinguishes "absent / not owned" from "already decided" so callers get an
   * actionable error.
   */
  private async decide(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
    status: "accepted" | "rejected";
  }): Promise<Proposal> {
    const updated = await this.repo.markDecided(input);
    if (updated !== null) {
      return updated;
    }
    // markDecided returns null for absent/not-owned AND for not-pending; read it
    // back to report the precise reason.
    const existing = await this.repo.get(input);
    if (existing === null) {
      throw new ProposalError(
        "not_found",
        `Proposal ${input.proposalId} was not found for this diagram. ` +
          "Check the id, or list pending proposals to see what is available.",
      );
    }
    throw new ProposalError(
      "not_pending",
      `Proposal ${input.proposalId} was already ${existing.status} and can't be ` +
        `${input.status === "accepted" ? "accepted" : "rejected"} again.`,
    );
  }

  /** Validate a staged edit through the v1 validator (same gate the commit
   * pipeline uses on accept). Unknown equipment types are caught at the boundary
   * by `parseStageInput`, so every element here resolves to a known SymbolId. */
  private validate(edit: DiagramEdit): ValidationReport {
    const types = this.resolveSymbolTypes(edit.elements);
    const snapshot: DiagramSnapshot = {
      elements: edit.elements.map((el, i) => ({
        id: el.id,
        equipmentType: types[i],
        portIds: el.portIds,
      })),
      connections: edit.connections satisfies readonly Connection[],
      metadata: edit.elements.map((el, i) => ({
        diagramVersionId: PRE_PERSIST_VERSION_ID,
        elementId: el.id,
        equipmentType: types[i],
        attributes: el.attributes,
      })),
    };
    return this.validator.validate(snapshot);
  }

  /** Narrow each element's open-string `equipmentType` to a known `SymbolId`,
   * failing at the boundary on an unknown type (never feed a bad type to the
   * validator). Mirrors the commit pipeline's boundary check. */
  private resolveSymbolTypes(
    elements: readonly CommitElementLike[],
  ): SymbolId[] {
    return elements.map((el) => {
      if (!isSymbolId(el.equipmentType)) {
        throw new ProposalError(
          "invalid_input",
          `Element "${el.id}" has unknown equipment type "${el.equipmentType}". ` +
            "Use a type from the equipment palette.",
        );
      }
      return el.equipmentType;
    });
  }

  /** Coerce a JSON-safe value to the `JsonObject` the repository persists,
   * proving JSON-safety at the boundary. Throws `invalid_input` on the
   * (unreachable-by-construction) chance a payload is not a JSON object. */
  private toJsonObject(value: unknown): JsonObject {
    const parsed = jsonObjectSchema.safeParse(value);
    if (!parsed.success) {
      throw new ProposalError(
        "invalid_input",
        "The staged change or validator report is not a JSON object and can't be persisted.",
      );
    }
    return parsed.data;
  }

  private parseStageInput(input: StageProposalInput): StageProposalInput {
    const parsed = stageProposalInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ProposalError(
        "invalid_input",
        "The proposal could not be staged: the diagram id or proposed edit is " +
          "malformed. Re-send a valid edit.",
      );
    }
    return parsed.data;
  }

  /** Read the staged edit back off a persisted proposal for the accept path.
   * The row was written from a validated edit, so this re-parse is a safety net
   * (defensive against a hand-edited DB row), not an expected failure. */
  private readStagedEdit(proposal: Proposal): { edit: DiagramEdit } {
    const change = proposal.stagedChange as { edit?: unknown };
    const parsed = stageProposalInputSchema.shape.edit.safeParse(change.edit);
    if (!parsed.success) {
      throw new ProposalError(
        "invalid_input",
        `Proposal ${proposal.id} has a malformed staged change and can't be committed.`,
      );
    }
    return { edit: parsed.data };
  }

  private async requireOwnedDiagram(
    accountId: string,
    diagramId: string,
  ): Promise<void> {
    const diagram = await this.diagrams.getDiagram({ accountId, diagramId });
    if (diagram === null) {
      throw new ProposalError(
        "not_found",
        `Diagram ${diagramId} was not found for this account. ` +
          "Check the id, or list your diagrams to see what is available.",
      );
    }
    // For the in-memory repository, register ownership so account-scoped reads
    // resolve. No-op for repositories that derive scope from the DB (Postgres).
    if (this.repo instanceof InMemoryProposalRepository) {
      this.repo.registerDiagram(diagramId, accountId);
    }
  }
}
