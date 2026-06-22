/**
 * Proposal-lifecycle types (DEV-1144, PRD §5.2 / §8, FR-7,10).
 *
 * The domain entity (`Proposal`) and its status enum live in `@/lib/types`
 * (DEV-1130). This module models only the inputs/outputs the lifecycle surface
 * needs and a typed error for its boundary failures — mirroring the diagram
 * persistence task's `types.ts` split.
 *
 * Architecture invariants (CLAUDE.md) this layer upholds:
 *   - Proposals are STAGED, never applied. Staging a proposal validates the
 *     change and writes a `pending` row; it never touches canonical state.
 *   - One committer. Acceptance re-validates and commits through the SAME
 *     commit pipeline (DEV-1140) every manual edit uses — there is no second
 *     persist path. Rejection discards the proposal and writes nothing.
 *   - A proposal is terminal once accepted/rejected: it can never be re-decided.
 */
import { z } from "zod";
import { diagramEditSchema } from "@/lib/diagram/commit";
import type { CommitElement, DiagramEdit } from "@/lib/diagram/commit";
import { jsonObjectSchema } from "@/lib/types";

/**
 * What an MCP propose-tool (DEV-1150) submits to stage a proposal: the diagram
 * it targets, on whose behalf, and the source-agnostic edit Claude proposes.
 *
 * The edit is the very same {@link DiagramEdit} the commit pipeline consumes, so
 * the proposal that staged validly is the one the accept path re-validates and
 * commits — no shape translation between staging and acceptance.
 */
export const stageProposalInputSchema = z.object({
  accountId: z.string().min(1),
  diagramId: z.string().min(1),
  /** The change Claude proposes, in the committer's own edit shape. */
  edit: diagramEditSchema,
  /**
   * The delta the propose tool applied, stored opaquely (`lib/proposals` does not
   * know the `ProposeOp` shape). Source of truth for accept: re-materialized
   * against current committed state so accept never clobbers a prior commit. Optional
   * so legacy callers (no op) still stage and accept the stored `edit`.
   */
  op: jsonObjectSchema.optional(),
});
export type StageProposalInput = z.infer<typeof stageProposalInputSchema>;

/** Re-export the edit schema/type used at this boundary for convenience. */
export { diagramEditSchema };
export type { DiagramEdit };

/**
 * One placed element of a staged edit, as the lifecycle's symbol-resolution step
 * sees it (id + open-string equipment type). Aliases the commit pipeline's
 * `CommitElement` so the two layers agree on the edit's element shape.
 */
export type CommitElementLike = CommitElement;

/**
 * The persisted `staged_change` payload.
 *
 * `op` is the DELTA the propose tool applied (an opaque `JsonObject` here — the
 * `lib/mcp-tools` layer owns its concrete `ProposeOp` shape; `lib/proposals` must
 * NOT import it, to avoid a layering cycle). It is the SOURCE OF TRUTH for accept:
 * acceptance materializes the op against CURRENT committed state, so accepting one
 * proposal never clobbers another already-committed one.
 *
 * `edit` is the effective+new WHOLE-scene edit computed at stage time (committed +
 * all pending ops + this op). It is kept for two reasons: (1) stage-time
 * validation (so cross-pending issues are caught before a row is written), and (2)
 * the editor's pending overlay / SVG projection reads it. Do not remove it.
 *
 * Legacy rows (pre-delta) have only `edit`; `op` is therefore optional and the
 * accept path falls back to committing `edit` when no `op` is present.
 */
export const stagedChangeSchema = z.object({
  /** The delta the propose tool applied. Opaque JSON; mcp-tools owns its shape. */
  op: jsonObjectSchema.optional(),
  /** Effective whole-scene edit (committed + pending + this op): validation + display. */
  edit: diagramEditSchema,
});
export type StagedChange = z.infer<typeof stagedChangeSchema>;

/**
 * A row to insert when staging. `validatorReport` is the report the validator
 * produced over the staged edit (FR-8: a proposal only stages if it is valid,
 * so this report is `valid: true` for every persisted pending proposal). Both
 * JSON payloads are stored opaquely (`jsonObjectSchema`) at the repository
 * boundary; the service owns their concrete shapes.
 */
export const createProposalInputSchema = z.object({
  diagramId: z.string().min(1),
  stagedChange: jsonObjectSchema,
  validatorReport: jsonObjectSchema,
});
export type CreateProposalInput = z.infer<typeof createProposalInputSchema>;

/** Typed failure modes at the proposal lifecycle boundary. */
export type ProposalErrorCode =
  | "not_found" // proposal absent or not on the named diagram/account
  | "invalid_input" // malformed stage payload
  | "invalid_proposal" // staging refused: the proposed edit fails validation (FR-8)
  | "not_pending"; // accept/reject of an already-decided proposal

/**
 * Boundary error for the proposal lifecycle. Messages say what happened + how to
 * fix (CLAUDE.md), produced from the discriminant at the call site. `invalid_proposal`
 * carries the validator report so the caller (an MCP tool) can return the reasons
 * to Claude rather than silently staging a broken change (FR-8).
 */
export class ProposalError extends Error {
  readonly code: ProposalErrorCode;
  /** Validator report — present only for `invalid_proposal`. */
  readonly report?: unknown;
  constructor(code: ProposalErrorCode, message: string, report?: unknown) {
    super(message);
    this.name = "ProposalError";
    this.code = code;
    this.report = report;
  }
}
