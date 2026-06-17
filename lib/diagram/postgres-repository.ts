/**
 * Postgres-backed DiagramRepository (DEV-1135).
 *
 * The production canonical store. Tables (`diagram`, `diagram_version`,
 * `element_metadata`) are owned by the schema task (DEV-1132, migration 0001);
 * this is data-access only — no DDL.
 *
 * Tenant isolation: every query is scoped by `account_id`, so a diagram owned by
 * another account is invisible (returns null / false), never leaked.
 *
 * Immutability (CLAUDE.md): `saveVersion` only ever INSERTs a new
 * `diagram_version` row plus its `element_metadata`. It never UPDATEs a prior
 * version — the schema's append-only trigger would reject that anyway. Scene +
 * metadata are written in one transaction so a version is never half-persisted.
 */
import type { Pool, PoolClient } from "pg";
import type { Diagram, DiagramVersion, ElementMetadata } from "@/lib/types";
import type { DiagramRepository } from "./repository";
import type { SaveVersionInput, VersionSnapshot } from "./types";

interface DiagramRow {
  id: string;
  account_id: string;
  name: string;
  active: boolean;
}

interface VersionRow {
  id: string;
  diagram_id: string;
  excalidraw_scene: Record<string, unknown>;
  created_at: Date;
}

interface MetadataRow {
  diagram_version_id: string;
  element_id: string;
  equipment_type: string;
  attributes: Record<string, unknown>;
}

function toDiagram(row: DiagramRow): Diagram {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    active: row.active,
  };
}

function toVersion(row: VersionRow): DiagramVersion {
  return {
    id: row.id,
    diagramId: row.diagram_id,
    excalidrawScene: row.excalidraw_scene as DiagramVersion["excalidrawScene"],
    createdAt: row.created_at.toISOString(),
  };
}

function toMetadata(row: MetadataRow): ElementMetadata {
  return {
    diagramVersionId: row.diagram_version_id,
    elementId: row.element_id,
    equipmentType: row.equipment_type,
    attributes: row.attributes as ElementMetadata["attributes"],
  };
}

export class PostgresDiagramRepository implements DiagramRepository {
  constructor(private readonly pool: Pool) {}

  async createDiagram(input: { accountId: string; name: string }): Promise<Diagram> {
    const { rows } = await this.pool.query<DiagramRow>(
      `INSERT INTO diagram (account_id, name)
       VALUES ($1, $2)
       RETURNING id, account_id, name, active`,
      [input.accountId, input.name],
    );
    return toDiagram(rows[0]);
  }

  async listDiagrams(accountId: string): Promise<Diagram[]> {
    const { rows } = await this.pool.query<DiagramRow>(
      `SELECT id, account_id, name, active
       FROM diagram
       WHERE account_id = $1
       ORDER BY created_at DESC, id DESC`,
      [accountId],
    );
    return rows.map(toDiagram);
  }

  async getDiagram(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Diagram | null> {
    const { rows } = await this.pool.query<DiagramRow>(
      `SELECT id, account_id, name, active
       FROM diagram
       WHERE id = $1 AND account_id = $2`,
      [input.diagramId, input.accountId],
    );
    return rows[0] ? toDiagram(rows[0]) : null;
  }

  async renameDiagram(input: {
    accountId: string;
    diagramId: string;
    name: string;
  }): Promise<Diagram | null> {
    const { rows } = await this.pool.query<DiagramRow>(
      `UPDATE diagram
       SET name = $3
       WHERE id = $1 AND account_id = $2
       RETURNING id, account_id, name, active`,
      [input.diagramId, input.accountId, input.name],
    );
    return rows[0] ? toDiagram(rows[0]) : null;
  }

  async deleteDiagram(input: {
    accountId: string;
    diagramId: string;
  }): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM diagram
       WHERE id = $1 AND account_id = $2`,
      [input.diagramId, input.accountId],
    );
    return (rowCount ?? 0) > 0;
  }

  async saveVersion(input: {
    accountId: string;
    diagramId: string;
    save: SaveVersionInput;
  }): Promise<VersionSnapshot | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const snapshot = await this.insertVersion(client, input);
      await client.query("COMMIT");
      return snapshot;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async insertVersion(
    client: PoolClient,
    input: {
      accountId: string;
      diagramId: string;
      save: SaveVersionInput;
    },
  ): Promise<VersionSnapshot | null> {
    // Ownership check inside the transaction; FOR UPDATE keeps a concurrent
    // delete from racing the version insert.
    const owned = await client.query<{ id: string }>(
      `SELECT id FROM diagram
       WHERE id = $1 AND account_id = $2
       FOR UPDATE`,
      [input.diagramId, input.accountId],
    );
    if (owned.rowCount === 0) {
      return null;
    }

    const versionResult = await client.query<VersionRow>(
      `INSERT INTO diagram_version (diagram_id, excalidraw_scene)
       VALUES ($1, $2)
       RETURNING id, diagram_id, excalidraw_scene, created_at`,
      [input.diagramId, JSON.stringify(input.save.excalidrawScene)],
    );
    const version = toVersion(versionResult.rows[0]);

    const metadata: ElementMetadata[] = [];
    for (const m of input.save.metadata) {
      const metaResult = await client.query<MetadataRow>(
        `INSERT INTO element_metadata
           (diagram_version_id, element_id, equipment_type, attributes)
         VALUES ($1, $2, $3, $4)
         RETURNING diagram_version_id, element_id, equipment_type, attributes`,
        [version.id, m.elementId, m.equipmentType, JSON.stringify(m.attributes)],
      );
      metadata.push(toMetadata(metaResult.rows[0]));
    }

    return { version, metadata };
  }

  async listVersions(input: {
    accountId: string;
    diagramId: string;
  }): Promise<DiagramVersion[] | null> {
    const owned = await this.getDiagram(input);
    if (owned === null) {
      return null;
    }
    const { rows } = await this.pool.query<VersionRow>(
      `SELECT id, diagram_id, excalidraw_scene, created_at
       FROM diagram_version
       WHERE diagram_id = $1
       ORDER BY created_at DESC, id DESC`,
      [input.diagramId],
    );
    return rows.map(toVersion);
  }

  async getVersion(input: {
    accountId: string;
    diagramId: string;
    versionId: string;
  }): Promise<VersionSnapshot | null> {
    // Join through diagram so the account scope is enforced server-side.
    const versionResult = await this.pool.query<VersionRow>(
      `SELECT v.id, v.diagram_id, v.excalidraw_scene, v.created_at
       FROM diagram_version v
       JOIN diagram d ON d.id = v.diagram_id
       WHERE v.id = $1 AND v.diagram_id = $2 AND d.account_id = $3`,
      [input.versionId, input.diagramId, input.accountId],
    );
    if (versionResult.rowCount === 0) {
      return null;
    }
    const version = toVersion(versionResult.rows[0]);

    const metaResult = await this.pool.query<MetadataRow>(
      `SELECT diagram_version_id, element_id, equipment_type, attributes
       FROM element_metadata
       WHERE diagram_version_id = $1
       ORDER BY element_id ASC`,
      [version.id],
    );
    return { version, metadata: metaResult.rows.map(toMetadata) };
  }
}
