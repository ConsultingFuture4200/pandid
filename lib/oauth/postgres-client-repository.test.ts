/**
 * PostgresOAuthClientRepository integration test (DEV-1148 / 15b, FR-21).
 *
 * Runs against a REAL, ephemeral Postgres — no mocks, no fallbacks (project
 * policy: real data sources only). A throwaway `postgres:16-alpine` container is
 * started for the suite and torn down after; the real migrations build the
 * schema, so the `oauth_clients` table (migration 0003) is the production one.
 *
 * Proves the persistence acceptance against the real DB: create + find,
 * round-trip of the array columns and the already-hashed secret, null on
 * unknown, and idempotent delete. The semantics mirror
 * `InMemoryOAuthClientRepository` exactly (it is the reference spec).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateUp } from "@/db/migrate";
import type { OAuthClientRecord } from "./types";
import { PostgresOAuthClientRepository } from "./postgres-client-repository";

const exec = promisify(execFile);

const CONTAINER_NAME = `pid-oauth-clients-test-${process.pid}`;
const PG_PASSWORD = "test";
const PG_DB = "pid_coeditor_test";

let hostPort: number;
let pool: Pool;

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

function makeRecord(overrides: Partial<OAuthClientRecord> = {}): OAuthClientRecord {
  return {
    id: crypto.randomUUID(),
    clientId: `client-${crypto.randomUUID()}`,
    // Already-hashed (64 hex). The repo must persist this verbatim, never re-hash.
    clientSecretHash: "a".repeat(64),
    redirectUris: ["https://claude.ai/callback", "https://example.com/cb"],
    clientName: "Claude Desktop",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    tokenEndpointAuthMethod: "client_secret_basic",
    scope: "mcp",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  if (!(await dockerAvailable())) {
    throw new Error(
      "Docker is required to run OAuth client persistence integration tests (real Postgres, no mocks). " +
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

describe("PostgresOAuthClientRepository", () => {
  it("creates a client and reads it back, round-tripping every field", async () => {
    const repo = new PostgresOAuthClientRepository(pool);
    const record = makeRecord();

    await repo.createClient(record);
    const found = await repo.findByClientId(record.clientId);

    expect(found).not.toBeNull();
    expect(found?.id).toBe(record.id);
    expect(found?.clientId).toBe(record.clientId);
    // The already-hashed secret is persisted verbatim — never re-hashed.
    expect(found?.clientSecretHash).toBe(record.clientSecretHash);
    expect(found?.redirectUris).toEqual(record.redirectUris);
    expect(found?.clientName).toBe(record.clientName);
    expect(found?.grantTypes).toEqual(record.grantTypes);
    expect(found?.responseTypes).toEqual(record.responseTypes);
    expect(found?.tokenEndpointAuthMethod).toBe(record.tokenEndpointAuthMethod);
    expect(found?.scope).toBe(record.scope);
    // TIMESTAMPTZ round-trips to the same instant.
    expect(new Date(found!.createdAt).getTime()).toBe(
      new Date(record.createdAt).getTime(),
    );
  });

  it("persists a public client with null secret hash and null name/scope", async () => {
    const repo = new PostgresOAuthClientRepository(pool);
    const record = makeRecord({
      clientSecretHash: null,
      clientName: null,
      scope: null,
      tokenEndpointAuthMethod: "none",
    });

    await repo.createClient(record);
    const found = await repo.findByClientId(record.clientId);

    expect(found?.clientSecretHash).toBeNull();
    expect(found?.clientName).toBeNull();
    expect(found?.scope).toBeNull();
    expect(found?.tokenEndpointAuthMethod).toBe("none");
  });

  it("returns null for an unknown client id", async () => {
    const repo = new PostgresOAuthClientRepository(pool);
    expect(await repo.findByClientId(`missing-${crypto.randomUUID()}`)).toBeNull();
  });

  it("deletes a client (so find returns null) and is idempotent", async () => {
    const repo = new PostgresOAuthClientRepository(pool);
    const record = makeRecord();

    await repo.createClient(record);
    expect(await repo.findByClientId(record.clientId)).not.toBeNull();

    await repo.deleteByClientId(record.clientId);
    expect(await repo.findByClientId(record.clientId)).toBeNull();

    // Idempotent: deleting an absent client is not an error.
    await expect(repo.deleteByClientId(record.clientId)).resolves.toBeUndefined();
  });
});
