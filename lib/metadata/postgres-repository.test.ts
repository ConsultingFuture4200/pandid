/**
 * PostgresElementMetadataRepository integration test (DEV-1135, FR-14).
 *
 * Runs against a REAL, ephemeral Postgres — no mocks, no fallbacks (project
 * policy: real data sources only). A throwaway `postgres:16-alpine` container is
 * started for the suite and torn down after; the real migrations build the
 * schema, so the `element_metadata` table, its composite PK, the JSONB column,
 * and the FK to `diagram_version` are the production ones.
 *
 * Proves the metadata persistence acceptance against the real DB: upsert/find
 * round-trip with JSONB attributes, upsert replacing within a version, upsertMany
 * snapshotting a whole version atomically, listByVersion scoping, and delete
 * being idempotent. Metadata is written per immutable `diagramVersionId`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "@/db/migrate";
import type { ElementMetadata } from "@/lib/types";
import { PostgresElementMetadataRepository } from "./postgres-repository";

const exec = promisify(execFile);

const CONTAINER_NAME = `pid-metadata-test-${process.pid}`;
const PG_PASSWORD = "test";
const PG_DB = "pid_coeditor_test";

let hostPort: number;
let pool: Pool;
// Two distinct immutable versions so listByVersion scoping can be proven.
let versionId: string;
let otherVersionId: string;

async function dockerAvailable(): Promise<boolean> {
  try {
    await exec("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

function clientConfig() {
  return {
    host: "127.0.0.1",
    port: hostPort,
    user: "postgres",
    password: PG_PASSWORD,
    database: PG_DB,
  };
}

async function waitForReady(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const c = new Client(clientConfig());
    try {
      await c.connect();
      await c.query("SELECT 1");
      await c.end();
      return;
    } catch (err) {
      lastErr = err;
      await c.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres did not become ready in ${timeoutMs}ms: ${String(lastErr)}`);
}

/** Create account → diagram → diagram_version; return the new version id. */
async function createVersion(): Promise<string> {
  const account = await pool.query<{ id: string }>(
    "INSERT INTO account (email) VALUES ($1) RETURNING id",
    [`meta-${Date.now()}-${Math.random()}@example.com`],
  );
  const diagram = await pool.query<{ id: string }>(
    "INSERT INTO diagram (account_id, name) VALUES ($1, $2) RETURNING id",
    [account.rows[0].id, "metadata-fixture"],
  );
  const version = await pool.query<{ id: string }>(
    "INSERT INTO diagram_version (diagram_id, excalidraw_scene) VALUES ($1, $2) RETURNING id",
    [diagram.rows[0].id, JSON.stringify({ elements: [] })],
  );
  return version.rows[0].id;
}

beforeAll(async () => {
  if (!(await dockerAvailable())) {
    throw new Error(
      "Docker is required to run metadata persistence integration tests (real Postgres, no mocks). " +
        "Start Docker and re-run `pnpm test`.",
    );
  }

  const { stdout } = await exec("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    CONTAINER_NAME,
    "-e",
    `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e",
    `POSTGRES_DB=${PG_DB}`,
    "-P",
    "postgres:16-alpine",
  ]);
  const containerId = stdout.trim();

  const { stdout: portOut } = await exec("docker", ["port", containerId, "5432/tcp"]);
  const portMatch = /:(\d+)\s*$/m.exec(portOut.trim());
  if (!portMatch) {
    throw new Error(`Could not parse mapped port from: ${portOut}`);
  }
  hostPort = Number.parseInt(portMatch[1], 10);

  await waitForReady();

  // Build the schema with the real migrations.
  const migrateClient = new Client(clientConfig());
  await migrateClient.connect();
  try {
    await migrateUp(migrateClient);
  } finally {
    await migrateClient.end();
  }

  pool = new Pool(clientConfig());
}, 60_000);

afterAll(async () => {
  await pool?.end().catch(() => undefined);
  await exec("docker", ["rm", "-f", CONTAINER_NAME]).catch(() => undefined);
});

beforeEach(async () => {
  // Fresh, disjoint versions per test (immutable versions are never deleted).
  versionId = await createVersion();
  otherVersionId = await createVersion();
});

describe("PostgresElementMetadataRepository", () => {
  it("upserts then finds a record, round-tripping JSONB attributes", async () => {
    const repo = new PostgresElementMetadataRepository(pool);
    const record: ElementMetadata = {
      diagramVersionId: versionId,
      elementId: "ex-1",
      equipmentType: "extraction_column",
      attributes: { tag: "EX-101", capacity: "5L", nested: { rated: true } },
    };

    expect(await repo.find(versionId, "ex-1")).toBeNull();
    await repo.upsert(record);
    expect(await repo.find(versionId, "ex-1")).toEqual(record);
  });

  it("upsert replaces the prior record for the same key within a version", async () => {
    const repo = new PostgresElementMetadataRepository(pool);
    await repo.upsert({
      diagramVersionId: versionId,
      elementId: "ex-1",
      equipmentType: "pump",
      attributes: { tag: "P-1" },
    });
    await repo.upsert({
      diagramVersionId: versionId,
      elementId: "ex-1",
      equipmentType: "extraction_column",
      attributes: { tag: "EX-101" },
    });

    const found = await repo.find(versionId, "ex-1");
    expect(found?.equipmentType).toBe("extraction_column");
    expect(found?.attributes).toEqual({ tag: "EX-101" });
    expect(await repo.listByVersion(versionId)).toHaveLength(1);
  });

  it("upsertMany snapshots a whole version and lists by version, scoped", async () => {
    const repo = new PostgresElementMetadataRepository(pool);
    const records: ElementMetadata[] = [
      {
        diagramVersionId: versionId,
        elementId: "a",
        equipmentType: "pump",
        attributes: { tag: "P-1" },
      },
      {
        diagramVersionId: versionId,
        elementId: "b",
        equipmentType: "tank",
        attributes: { tag: "T-1" },
      },
    ];
    await repo.upsertMany(records);

    expect(await repo.listByVersion(versionId)).toEqual(records);
    // Scoped strictly to its version — the other version sees nothing.
    expect(await repo.listByVersion(otherVersionId)).toEqual([]);

    // Empty upsertMany is a no-op.
    await expect(repo.upsertMany([])).resolves.toBeUndefined();
    expect(await repo.listByVersion(versionId)).toHaveLength(2);
  });

  it("rolls back upsertMany atomically when a record is invalid", async () => {
    const repo = new PostgresElementMetadataRepository(pool);
    // The second record references a version that does not exist → FK violation;
    // the whole batch must roll back, leaving zero rows for `versionId`.
    await expect(
      repo.upsertMany([
        {
          diagramVersionId: versionId,
          elementId: "a",
          equipmentType: "pump",
          attributes: {},
        },
        {
          diagramVersionId: crypto.randomUUID(),
          elementId: "b",
          equipmentType: "tank",
          attributes: {},
        },
      ]),
    ).rejects.toThrow();
    expect(await repo.listByVersion(versionId)).toEqual([]);
  });

  it("deletes idempotently, returning whether a row was removed", async () => {
    const repo = new PostgresElementMetadataRepository(pool);
    await repo.upsert({
      diagramVersionId: versionId,
      elementId: "ex-1",
      equipmentType: "pump",
      attributes: {},
    });

    expect(await repo.delete(versionId, "ex-1")).toBe(true);
    expect(await repo.find(versionId, "ex-1")).toBeNull();
    // Deleting an absent key returns false, never throws.
    expect(await repo.delete(versionId, "ex-1")).toBe(false);
    expect(await repo.delete(versionId, "never")).toBe(false);
  });
});
