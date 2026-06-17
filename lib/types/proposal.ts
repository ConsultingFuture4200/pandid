/**
 * Proposal — staged, never-applied change from Claude (via MCP).
 *
 * PRD §7: Proposal (id, diagram_id, staged_change JSON, validator_report,
 * status: pending/accepted/rejected).
 *
 * Architecture invariant (CLAUDE.md): proposals are STAGED, never applied.
 * Claude never commits to the canvas — an MCP propose-tool creates a `Proposal`
 * row; only human acceptance (re-validated through the single commit pipeline)
 * commits. Any path where a proposal mutates canonical state without human
 * acceptance is a bug. `stagedChange` and `validatorReport` are opaque JSON at
 * this layer (the validator interface — DEV-1133 — owns the report shape).
 */
import { z } from "zod";
import { isoTimestampSchema, jsonObjectSchema, uuidSchema } from "./common";

export const proposalStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const proposalSchema = z.object({
  id: uuidSchema,
  diagramId: uuidSchema,
  /** The change Claude proposes. Opaque JSON; applied only on human acceptance. */
  stagedChange: jsonObjectSchema,
  /**
   * Result of validating the staged change at staging time. Opaque JSON here;
   * the validator (DEV-1133) owns its concrete shape behind its interface.
   */
  validatorReport: jsonObjectSchema,
  status: proposalStatusSchema,
  createdAt: isoTimestampSchema,
});

export type Proposal = z.infer<typeof proposalSchema>;
