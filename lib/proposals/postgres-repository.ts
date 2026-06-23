/**
 * Postgres-backed ProposalRepository (DEV-1144).
 *
 * The production store for staged proposals. The `proposal` table (and its
 * `proposal_status` enum) is owned by the schema task (DEV-1132, migration 0001);
 * this is data-access only — no DDL.
 *
 * Tenant isolation: every read/decide is scoped through a join to `diagram` on
 * `account_id`, so a proposal on another account's diagram is invisible (returns
 * null), never leaked.
 *
 * `markDecided` flips status only when the row is still `pending` (the
 * `AND status = 'pending'` guard), so an accepted/rejected proposal stays
 * terminal even under a concurrent double-decide — the loser's UPDATE matches no
 * row and returns null.
 */
import type { Pool } from "pg";
import type { Proposal, ProposalStatus } from "@/lib/types";
import type { ProposalRepository } from "./repository";
import type { CreateProposalInput } from "./types";

interface ProposalRow {
  id: string;
  diagram_id: string;
  staged_change: Record<string, unknown>;
  validator_report: Record<string, unknown>;
  status: ProposalStatus;
  created_at: Date;
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    diagramId: row.diagram_id,
    stagedChange: row.staged_change as Proposal["stagedChange"],
    validatorReport: row.validator_report as Proposal["validatorReport"],
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresProposalRepository implements ProposalRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateProposalInput): Promise<Proposal> {
    const { rows } = await this.pool.query<ProposalRow>(
      `INSERT INTO proposal (diagram_id, staged_change, validator_report)
       VALUES ($1, $2, $3)
       RETURNING id, diagram_id, staged_change, validator_report, status, created_at`,
      [
        input.diagramId,
        JSON.stringify(input.stagedChange),
        JSON.stringify(input.validatorReport),
      ],
    );
    return toProposal(rows[0]);
  }

  async get(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
  }): Promise<Proposal | null> {
    // Join through diagram so the account scope is enforced server-side.
    const { rows } = await this.pool.query<ProposalRow>(
      `SELECT p.id, p.diagram_id, p.staged_change, p.validator_report,
              p.status, p.created_at
       FROM proposal p
       JOIN diagram d ON d.id = p.diagram_id
       WHERE p.id = $1 AND p.diagram_id = $2 AND d.account_id = $3`,
      [input.proposalId, input.diagramId, input.accountId],
    );
    return rows[0] ? toProposal(rows[0]) : null;
  }

  async markDecided(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
    status: "accepted" | "rejected";
  }): Promise<Proposal | null> {
    // The status guard + the account/diagram scope are all in the WHERE clause,
    // so a non-pending, unowned, or absent proposal matches no row → null.
    const { rows } = await this.pool.query<ProposalRow>(
      `UPDATE proposal p
       SET status = $4
       FROM diagram d
       WHERE p.id = $1
         AND p.diagram_id = $2
         AND d.id = p.diagram_id
         AND d.account_id = $3
         AND p.status = 'pending'
       RETURNING p.id, p.diagram_id, p.staged_change, p.validator_report,
                 p.status, p.created_at`,
      [input.proposalId, input.diagramId, input.accountId, input.status],
    );
    return rows[0] ? toProposal(rows[0]) : null;
  }

  async revertToPending(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
  }): Promise<Proposal | null> {
    // Guarded to `accepted` (the only status `accept` claims before committing),
    // account/diagram-scoped, so it never resurrects a rejected proposal or one
    // on another account's diagram.
    const { rows } = await this.pool.query<ProposalRow>(
      `UPDATE proposal p
       SET status = 'pending'
       FROM diagram d
       WHERE p.id = $1
         AND p.diagram_id = $2
         AND d.id = p.diagram_id
         AND d.account_id = $3
         AND p.status = 'accepted'
       RETURNING p.id, p.diagram_id, p.staged_change, p.validator_report,
                 p.status, p.created_at`,
      [input.proposalId, input.diagramId, input.accountId],
    );
    return rows[0] ? toProposal(rows[0]) : null;
  }

  async listPending(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Proposal[]> {
    const { rows } = await this.pool.query<ProposalRow>(
      `SELECT p.id, p.diagram_id, p.staged_change, p.validator_report,
              p.status, p.created_at
       FROM proposal p
       JOIN diagram d ON d.id = p.diagram_id
       WHERE p.diagram_id = $1 AND d.account_id = $2 AND p.status = 'pending'
       ORDER BY p.created_at DESC, p.id DESC`,
      [input.diagramId, input.accountId],
    );
    return rows.map(toProposal);
  }
}
