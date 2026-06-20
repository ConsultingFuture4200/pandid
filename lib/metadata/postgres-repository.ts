/**
 * Postgres-backed ElementMetadataRepository (DEV-1135, FR-14).
 *
 * The production store for the parallel, element-id-keyed equipment metadata —
 * the single source of truth because `convertToExcalidrawElements` drops
 * `customData` (CLAUDE.md fact #1). The `element_metadata` table is owned by the
 * schema task (DEV-1132, migration 0001); this is data-access only — no DDL.
 *
 * Key: `(diagram_version_id, element_id)` (the table's composite primary key).
 * `attributes` is JSONB; it round-trips as a plain object — written with
 * `JSON.stringify` (matching the diagram repo's metadata writes) and read back as
 * the `pg`-parsed object, narrowed to `ElementMetadata["attributes"]`.
 *
 * Versions are immutable (CLAUDE.md): the commit pipeline snapshots a fresh set of
 * rows per new `diagramVersionId`. `upsert` writing the same key replaces only
 * within its own version; it never mutates another version's rows.
 */
import type { Pool, PoolClient } from "pg";
import type { ElementMetadata } from "@/lib/types";
import type { ElementMetadataRepository } from "./repository";

interface MetadataRow {
  diagram_version_id: string;
  element_id: string;
  equipment_type: string;
  attributes: Record<string, unknown>;
}

function toMetadata(row: MetadataRow): ElementMetadata {
  return {
    diagramVersionId: row.diagram_version_id,
    elementId: row.element_id,
    equipmentType: row.equipment_type,
    attributes: row.attributes as ElementMetadata["attributes"],
  };
}

async function upsertOne(
  executor: Pool | PoolClient,
  record: ElementMetadata,
): Promise<void> {
  // Keyed by the composite PK: writing the same (version, element) replaces the
  // prior record for that key within the version (in-memory `upsert` semantics).
  await executor.query(
    `INSERT INTO element_metadata
       (diagram_version_id, element_id, equipment_type, attributes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (diagram_version_id, element_id)
     DO UPDATE SET
       equipment_type = EXCLUDED.equipment_type,
       attributes = EXCLUDED.attributes`,
    [
      record.diagramVersionId,
      record.elementId,
      record.equipmentType,
      JSON.stringify(record.attributes),
    ],
  );
}

export class PostgresElementMetadataRepository
  implements ElementMetadataRepository
{
  constructor(private readonly pool: Pool) {}

  async upsert(record: ElementMetadata): Promise<void> {
    await upsertOne(this.pool, record);
  }

  async upsertMany(records: readonly ElementMetadata[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    // One transaction so a whole-version snapshot lands all-or-nothing, matching
    // the diagram repo's atomic metadata write.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const record of records) {
        await upsertOne(client, record);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async find(
    diagramVersionId: string,
    elementId: string,
  ): Promise<ElementMetadata | null> {
    const { rows } = await this.pool.query<MetadataRow>(
      `SELECT diagram_version_id, element_id, equipment_type, attributes
       FROM element_metadata
       WHERE diagram_version_id = $1 AND element_id = $2`,
      [diagramVersionId, elementId],
    );
    return rows[0] ? toMetadata(rows[0]) : null;
  }

  async listByVersion(diagramVersionId: string): Promise<ElementMetadata[]> {
    const { rows } = await this.pool.query<MetadataRow>(
      `SELECT diagram_version_id, element_id, equipment_type, attributes
       FROM element_metadata
       WHERE diagram_version_id = $1
       ORDER BY element_id ASC`,
      [diagramVersionId],
    );
    return rows.map(toMetadata);
  }

  async delete(diagramVersionId: string, elementId: string): Promise<boolean> {
    // Idempotent: deleting an absent key returns false, never throws (matches
    // the in-memory repo's `Map.delete` return).
    const { rowCount } = await this.pool.query(
      `DELETE FROM element_metadata
       WHERE diagram_version_id = $1 AND element_id = $2`,
      [diagramVersionId, elementId],
    );
    return (rowCount ?? 0) > 0;
  }
}
