/**
 * Proposal persistence interface (DEV-1144, PRD §7).
 *
 * The lifecycle service depends on this interface, never on a concrete driver,
 * so the lifecycle is unit-testable with an in-memory implementation and the
 * Postgres-backed implementation is a drop-in (mirrors the diagram task's
 * repository/service split).
 *
 * The repository persists the staged row and flips status; it never validates or
 * commits. Re-validation and the actual commit happen in the service, through the
 * single commit pipeline (CLAUDE.md: one committer). `markDecided` is the only
 * mutation of an existing row and is guarded so a terminal proposal stays terminal.
 */
import type { Proposal } from "@/lib/types";
import type { CreateProposalInput } from "./types";

export interface ProposalRepository {
  /**
   * Insert a new `pending` proposal. Returns the created row (status `pending`,
   * server-assigned id + createdAt).
   */
  create(input: CreateProposalInput): Promise<Proposal>;

  /**
   * Fetch a proposal scoped to its diagram + owning account, or null if it does
   * not exist, is not on that diagram, or the diagram belongs to another account
   * (tenant isolation). The account scope is enforced via the diagram join.
   */
  get(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
  }): Promise<Proposal | null>;

  /**
   * Atomically flip a `pending` proposal to `accepted` or `rejected`, scoped to
   * its diagram + account. Returns the updated row, or null if the proposal is
   * absent / not owned / no longer pending (a lost race or a double-decide). The
   * guard is what keeps a terminal proposal terminal.
   */
  markDecided(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
    status: "accepted" | "rejected";
  }): Promise<Proposal | null>;

  /** List a diagram's pending proposals, newest first (for the canvas UI). */
  listPending(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Proposal[]>;
}
