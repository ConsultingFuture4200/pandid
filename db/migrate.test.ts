/**
 * Migration up/down integration test (DEV-1132 acceptance:
 * "pnpm test covers migration up/down").
 *
 * Runs against a REAL, ephemeral Postgres — no mocks, no fallbacks (project
 * policy: real data sources only). A throwaway `postgres:16-alpine` container
 * is started for the suite and torn down after, so the test is self-contained
 * and idempotent on an empty DB.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations, migrateDown, migrateUp } from "./migrate";

const exec = promisify(execFile);

const CONTAINER_NAME = `pid-migrate-test-${process.pid}`;
const PG_PASSWORD = "test";
const PG_DB = "pid_coeditor_test";
const APP_TABLES = ["account", "diagram", "diagram_version", "element_metadata", "proposal"];

let hostPort: number;

async function dockerAvailable(): Promise<boolean> {
  try {
    await exec("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

/** Poll until Postgres accepts queries (container boot is not instant). */
async function waitForReady(client: () => Client, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    const c = client();
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

function makeClient(): Client {
  return new Client({
    host: "127.0.0.1",
    port: hostPort,
    user: "postgres",
    password: PG_PASSWORD,
    database: PG_DB,
  });
}

beforeAll(async () => {
  if (!(await dockerAvailable())) {
    throw new Error(
      "Docker is required to run migration integration tests (real Postgres, no mocks). " +
        "Start Docker and re-run `pnpm test`.",
    );
  }

  // Random ephemeral host port; let Docker map 5432 to a free port and read it back.
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
  // e.g. "0.0.0.0:49153\n[::]:49153\n" — take the first mapping's port.
  const portMatch = /:(\d+)\s*$/m.exec(portOut.trim());
  if (!portMatch) {
    throw new Error(`Could not parse mapped port from: ${portOut}`);
  }
  hostPort = Number.parseInt(portMatch[1], 10);

  await waitForReady(makeClient);
}, 60_000);

afterAll(async () => {
  await exec("docker", ["rm", "-f", CONTAINER_NAME]).catch(() => undefined);
});

describe("migrations", () => {
  it("discovers paired up/down migrations in order", async () => {
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0].version).toBe("0001");
    for (const m of migrations) {
      expect(m.upSql.length).toBeGreaterThan(0);
      expect(m.downSql.length).toBeGreaterThan(0);
    }
  });

  it("runs up cleanly on an empty DB, creating all PRD §7 tables", async () => {
    const client = makeClient();
    await client.connect();
    try {
      const ran = await migrateUp(client);
      expect(ran).toContain("0001");

      const { rows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const tables = new Set(rows.map((r) => r.table_name));
      for (const t of APP_TABLES) {
        expect(tables.has(t)).toBe(true);
      }
      expect(tables.has("schema_migrations")).toBe(true);
    } finally {
      await client.end();
    }
  });

  it("is idempotent — re-running up applies nothing", async () => {
    const client = makeClient();
    await client.connect();
    try {
      const ran = await migrateUp(client);
      expect(ran).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("enforces diagram_version immutability (UPDATE and DELETE blocked)", async () => {
    const client = makeClient();
    await client.connect();
    try {
      const account = await client.query<{ id: string }>(
        "INSERT INTO account (email) VALUES ($1) RETURNING id",
        [`immutable-${Date.now()}@example.com`],
      );
      const accountId = account.rows[0].id;
      const diagram = await client.query<{ id: string }>(
        "INSERT INTO diagram (account_id, name) VALUES ($1, $2) RETURNING id",
        [accountId, "rig"],
      );
      const diagramId = diagram.rows[0].id;
      const version = await client.query<{ id: string }>(
        "INSERT INTO diagram_version (diagram_id, excalidraw_scene) VALUES ($1, $2) RETURNING id",
        [diagramId, JSON.stringify({ elements: [] })],
      );
      const versionId = version.rows[0].id;

      await expect(
        client.query("UPDATE diagram_version SET excalidraw_scene = $1 WHERE id = $2", [
          JSON.stringify({ elements: ["mutated"] }),
          versionId,
        ]),
      ).rejects.toThrow(/append-only/);

      await expect(
        client.query("DELETE FROM diagram_version WHERE id = $1", [versionId]),
      ).rejects.toThrow(/append-only/);
    } finally {
      await client.end();
    }
  });

  it("keys element_metadata by (diagram_version_id, element_id) with JSONB attributes", async () => {
    const client = makeClient();
    await client.connect();
    try {
      const account = await client.query<{ id: string }>(
        "INSERT INTO account (email) VALUES ($1) RETURNING id",
        [`meta-${Date.now()}@example.com`],
      );
      const diagram = await client.query<{ id: string }>(
        "INSERT INTO diagram (account_id, name) VALUES ($1, $2) RETURNING id",
        [account.rows[0].id, "rig"],
      );
      const version = await client.query<{ id: string }>(
        "INSERT INTO diagram_version (diagram_id, excalidraw_scene) VALUES ($1, $2) RETURNING id",
        [diagram.rows[0].id, JSON.stringify({ elements: [] })],
      );
      const versionId = version.rows[0].id;

      await client.query(
        `INSERT INTO element_metadata (diagram_version_id, element_id, equipment_type, attributes)
         VALUES ($1, $2, $3, $4)`,
        [versionId, "el-1", "extractor", JSON.stringify({ tag: "EX-101", rating: "150psi" })],
      );

      // Composite PK: duplicate (version, element) rejected.
      await expect(
        client.query(
          `INSERT INTO element_metadata (diagram_version_id, element_id, equipment_type, attributes)
           VALUES ($1, $2, $3, $4)`,
          [versionId, "el-1", "extractor", JSON.stringify({})],
        ),
      ).rejects.toThrow();

      const { rows } = await client.query<{ attributes: { tag: string } }>(
        "SELECT attributes FROM element_metadata WHERE diagram_version_id = $1 AND element_id = $2",
        [versionId, "el-1"],
      );
      expect(rows[0].attributes.tag).toBe("EX-101");
    } finally {
      await client.end();
    }
  });

  it("allows at most one active diagram per account", async () => {
    const client = makeClient();
    await client.connect();
    try {
      const account = await client.query<{ id: string }>(
        "INSERT INTO account (email) VALUES ($1) RETURNING id",
        [`active-${Date.now()}@example.com`],
      );
      const accountId = account.rows[0].id;
      await client.query(
        "INSERT INTO diagram (account_id, name, active) VALUES ($1, $2, true)",
        [accountId, "first"],
      );
      await expect(
        client.query("INSERT INTO diagram (account_id, name, active) VALUES ($1, $2, true)", [
          accountId,
          "second",
        ]),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it("runs down cleanly, returning the DB to an empty (no app tables) state", async () => {
    const client = makeClient();
    await client.connect();
    try {
      const rolledBack = await migrateDown(client);
      expect(rolledBack).toContain("0001");

      const { rows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      const tables = new Set(rows.map((r) => r.table_name));
      for (const t of APP_TABLES) {
        expect(tables.has(t)).toBe(false);
      }
      // The proposal_status enum must also be gone.
      const { rows: typeRows } = await client.query<{ typname: string }>(
        "SELECT typname FROM pg_type WHERE typname = 'proposal_status'",
      );
      expect(typeRows.length).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("can re-apply after a full down (up/down/up cycle is clean)", async () => {
    const client = makeClient();
    await client.connect();
    try {
      const ran = await migrateUp(client);
      expect(ran).toContain("0001");
    } finally {
      await client.end();
    }
  });
});
