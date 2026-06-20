/**
 * Postgres-backed ScopingRepository (DEV-1149).
 *
 * The production store for the per-account active-diagram flag. Operates on the
 * `diagram.active` column + the partial unique index
 * `diagram_one_active_per_account_idx` (schema task DEV-1132, migration 0001) —
 * data-access only, no DDL.
 *
 * Tenant isolation: every statement is scoped by `account_id`, so a diagram
 * owned by another account is invisible (returns null) and can never be made
 * active for the wrong account.
 *
 * Single active per account: `setActiveDiagram` runs in one transaction that
 * first clears the account's prior active diagram, then sets the new one. The
 * partial unique index makes the invariant a hard DB constraint; doing both
 * writes in a transaction keeps the index from transiently seeing two active
 * rows.
 */
import type { Pool, PoolClient } from "pg";
import type { Diagram } from "@/lib/types";
import type { ScopingRepository } from "./types";

interface DiagramRow {
  id: string;
  account_id: string;
  name: string;
  active: boolean;
}

function toDiagram(row: DiagramRow): Diagram {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    active: row.active,
  };
}

export class PostgresScopingRepository implements ScopingRepository {
  constructor(private readonly pool: Pool) {}

  async getActiveDiagram(accountId: string): Promise<Diagram | null> {
    const { rows } = await this.pool.query<DiagramRow>(
      `SELECT id, account_id, name, active
       FROM diagram
       WHERE account_id = $1 AND active
       LIMIT 1`,
      [accountId],
    );
    return rows[0] ? toDiagram(rows[0]) : null;
  }

  async setActiveDiagram(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Diagram | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await this.activate(client, input);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async activate(
    client: PoolClient,
    input: { accountId: string; diagramId: string },
  ): Promise<Diagram | null> {
    // Ownership check inside the transaction; FOR UPDATE serializes concurrent
    // activations for the same account so the partial unique index never races.
    const owned = await client.query<{ id: string }>(
      `SELECT id FROM diagram
       WHERE id = $1 AND account_id = $2
       FOR UPDATE`,
      [input.diagramId, input.accountId],
    );
    if (owned.rowCount === 0) {
      return null;
    }

    // Clear the account's prior active diagram first so setting the new one can
    // never transiently violate the single-active partial unique index.
    await client.query(
      `UPDATE diagram
       SET active = false
       WHERE account_id = $1 AND active AND id <> $2`,
      [input.accountId, input.diagramId],
    );

    const { rows } = await client.query<DiagramRow>(
      `UPDATE diagram
       SET active = true
       WHERE id = $1 AND account_id = $2
       RETURNING id, account_id, name, active`,
      [input.diagramId, input.accountId],
    );
    return rows[0] ? toDiagram(rows[0]) : null;
  }

  async clearActiveDiagram(accountId: string): Promise<void> {
    await this.pool.query(
      `UPDATE diagram
       SET active = false
       WHERE account_id = $1 AND active`,
      [accountId],
    );
  }
}
