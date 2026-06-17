/**
 * PostgresDiagramRepository integration test (DEV-1135).
 *
 * Runs against a REAL, ephemeral Postgres — no mocks, no fallbacks (project
 * policy: real data sources only). A throwaway `postgres:16-alpine` container is
 * started for the suite and torn down after; the real migrations build the
 * schema, so the immutability trigger and FKs are the production ones.
 *
 * Proves the persistence acceptance against the real DB: CRUD per account,
 * append-only versioning, SC-6 restore (exact scene + metadata), and tenant
 * isolation (one account cannot read/write another's diagram).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "@/db/migrate";
import { PostgresDiagramRepository } from "./postgres-repository";

const exec = promisify(execFile);

const CONTAINER_NAME = `pid-diagram-test-${process.pid}`;
const PG_PASSWORD = "test";
const PG_DB = "pid_coeditor_test";

let hostPort: number;
let pool: Pool;
let accountId: string;
let otherAccountId: string;

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

beforeAll(async () => {
  if (!(await dockerAvailable())) {
    throw new Error(
      "Docker is required to run diagram persistence integration tests (real Postgres, no mocks). " +
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
  // Fresh, unique accounts per test. We deliberately do NOT delete prior rows:
  // the DEV-1132 append-only trigger blocks DELETE on diagram_version even via
  // cascade, so `DELETE FROM account` would fail once a versioned diagram exists.
  // Unique emails keep each test's data disjoint instead.
  const a = await pool.query<{ id: string }>(
    "INSERT INTO account (email) VALUES ($1) RETURNING id",
    [`owner-${Date.now()}-${Math.random()}@example.com`],
  );
  accountId = a.rows[0].id;
  const b = await pool.query<{ id: string }>(
    "INSERT INTO account (email) VALUES ($1) RETURNING id",
    [`other-${Date.now()}-${Math.random()}@example.com`],
  );
  otherAccountId = b.rows[0].id;
});

describe("PostgresDiagramRepository", () => {
  it("creates, lists, opens, renames, deletes diagrams per account", async () => {
    const repo = new PostgresDiagramRepository(pool);

    const created = await repo.createDiagram({ accountId, name: "Rig A" });
    expect(created.accountId).toBe(accountId);
    expect(created.name).toBe("Rig A");

    expect((await repo.listDiagrams(accountId)).map((d) => d.id)).toContain(created.id);
    expect(await repo.getDiagram({ accountId, diagramId: created.id })).not.toBeNull();

    const renamed = await repo.renameDiagram({
      accountId,
      diagramId: created.id,
      name: "Rig B",
    });
    expect(renamed?.name).toBe("Rig B");

    expect(await repo.deleteDiagram({ accountId, diagramId: created.id })).toBe(true);
    expect(await repo.getDiagram({ accountId, diagramId: created.id })).toBeNull();
    // Idempotent: deleting again returns false, not an error.
    expect(await repo.deleteDiagram({ accountId, diagramId: created.id })).toBe(false);
  });

  // CROSS-TASK CONFLICT (surfaced to lead): FR-17 requires "user deletes
  // diagrams", but the DEV-1132 append-only trigger on diagram_version blocks
  // DELETE *even via cascade*. So deleting a diagram that has saved versions
  // currently fails at the DB. The repository code is correct; the fix belongs
  // in the DEV-1132 schema (e.g. allow cascade delete when the parent diagram
  // is itself being deleted, while still blocking standalone version DELETE).
  // This test pins the present behavior so the regression is visible and the
  // conflict is not silently papered over. See the agent report / HUMAN note.
  it("currently CANNOT delete a versioned diagram — DEV-1132 trigger blocks cascade (FR-17 gap)", async () => {
    const repo = new PostgresDiagramRepository(pool);
    const d = await repo.createDiagram({ accountId, name: "has-versions" });
    await repo.saveVersion({
      accountId,
      diagramId: d.id,
      save: { excalidrawScene: { elements: [] }, metadata: [] },
    });
    await expect(
      repo.deleteDiagram({ accountId, diagramId: d.id }),
    ).rejects.toThrow(/append-only/);
  });

  it("appends immutable versions and lists them newest first", async () => {
    const repo = new PostgresDiagramRepository(pool);
    const d = await repo.createDiagram({ accountId, name: "versioned" });

    const v1 = await repo.saveVersion({
      accountId,
      diagramId: d.id,
      save: { excalidrawScene: { elements: [{ id: "a" }] }, metadata: [] },
    });
    const v2 = await repo.saveVersion({
      accountId,
      diagramId: d.id,
      save: { excalidrawScene: { elements: [{ id: "a" }, { id: "b" }] }, metadata: [] },
    });
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();

    const versions = await repo.listVersions({ accountId, diagramId: d.id });
    expect(versions).toHaveLength(2);
    expect(versions?.[0].id).toBe(v2?.version.id);
    expect(versions?.[1].id).toBe(v1?.version.id);
  });

  it("restores a prior version's exact scene + metadata (SC-6)", async () => {
    const repo = new PostgresDiagramRepository(pool);
    const d = await repo.createDiagram({ accountId, name: "sc6" });

    const scene = {
      elements: [{ id: "ex-1", type: "rectangle" }],
      appState: { viewBackgroundColor: "#ffffff" },
    };
    const saved = await repo.saveVersion({
      accountId,
      diagramId: d.id,
      save: {
        excalidrawScene: scene,
        metadata: [
          {
            elementId: "ex-1",
            equipmentType: "extraction_column",
            attributes: { tag: "EX-101", capacity: "5L" },
          },
        ],
      },
    });
    expect(saved).not.toBeNull();

    // A newer version exists so this must come back by id.
    await repo.saveVersion({
      accountId,
      diagramId: d.id,
      save: { excalidrawScene: { elements: [] }, metadata: [] },
    });

    const restored = await repo.getVersion({
      accountId,
      diagramId: d.id,
      versionId: saved!.version.id,
    });
    expect(restored?.version.excalidrawScene).toEqual(scene);
    expect(restored?.metadata).toEqual([
      {
        diagramVersionId: saved?.version.id,
        elementId: "ex-1",
        equipmentType: "extraction_column",
        attributes: { tag: "EX-101", capacity: "5L" },
      },
    ]);
  });

  it("saves the version + metadata atomically (duplicate element id rolls back)", async () => {
    const repo = new PostgresDiagramRepository(pool);
    const d = await repo.createDiagram({ accountId, name: "atomic" });

    // Two metadata rows with the same elementId violate the composite PK; the
    // whole save must roll back, leaving zero versions.
    await expect(
      repo.saveVersion({
        accountId,
        diagramId: d.id,
        save: {
          excalidrawScene: { elements: [] },
          metadata: [
            { elementId: "dup", equipmentType: "pump", attributes: {} },
            { elementId: "dup", equipmentType: "pump", attributes: {} },
          ],
        },
      }),
    ).rejects.toThrow();

    expect(await repo.listVersions({ accountId, diagramId: d.id })).toEqual([]);
  });

  it("enforces tenant isolation across CRUD, save, and restore", async () => {
    const repo = new PostgresDiagramRepository(pool);
    const d = await repo.createDiagram({ accountId, name: "private" });
    const saved = await repo.saveVersion({
      accountId,
      diagramId: d.id,
      save: { excalidrawScene: { elements: [] }, metadata: [] },
    });

    expect(await repo.listDiagrams(otherAccountId)).toEqual([]);
    expect(await repo.getDiagram({ accountId: otherAccountId, diagramId: d.id })).toBeNull();
    expect(
      await repo.renameDiagram({ accountId: otherAccountId, diagramId: d.id, name: "x" }),
    ).toBeNull();
    expect(await repo.deleteDiagram({ accountId: otherAccountId, diagramId: d.id })).toBe(false);
    expect(
      await repo.saveVersion({
        accountId: otherAccountId,
        diagramId: d.id,
        save: { excalidrawScene: {}, metadata: [] },
      }),
    ).toBeNull();
    expect(await repo.listVersions({ accountId: otherAccountId, diagramId: d.id })).toBeNull();
    expect(
      await repo.getVersion({
        accountId: otherAccountId,
        diagramId: d.id,
        versionId: saved!.version.id,
      }),
    ).toBeNull();

    // Still intact for the real owner.
    expect(await repo.getDiagram({ accountId, diagramId: d.id })).not.toBeNull();
  });
});
