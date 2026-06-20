/**
 * PostgresAuthRepository integration test (DEV-1135, FR-20).
 *
 * Runs against a REAL, ephemeral Postgres — no mocks, no fallbacks (project
 * policy: real data sources only). A throwaway `postgres:16-alpine` container is
 * started for the suite and torn down after; the real migrations build the
 * schema, so the `account` / `auth_credentials` / `sessions` tables, their
 * unique constraints, and FKs are the production ones.
 *
 * Proves the auth persistence acceptance against the real DB: credential lookup
 * by email, atomic account+credential creation (with the unique-email race
 * guard), session create/find/delete, account-email lookup, and that hashed
 * values are persisted verbatim (this layer never re-hashes).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateUp } from "@/db/migrate";
import { PostgresAuthRepository } from "./postgres-repository";
import { sessionExpiry } from "./session";

const exec = promisify(execFile);

const CONTAINER_NAME = `pid-auth-test-${process.pid}`;
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

beforeAll(async () => {
  if (!(await dockerAvailable())) {
    throw new Error(
      "Docker is required to run auth persistence integration tests (real Postgres, no mocks). " +
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

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random()}@example.com`;
}

describe("PostgresAuthRepository", () => {
  it("creates an account + credential atomically and finds it by email", async () => {
    const repo = new PostgresAuthRepository(pool);
    const email = uniqueEmail("create");
    const passwordHash = "scrypt$16384$8$1$deadbeef$cafef00d";

    expect(await repo.findCredentialByEmail(email)).toBeNull();

    const { accountId } = await repo.createAccountWithCredential({ email, passwordHash });
    expect(accountId).toMatch(/[0-9a-f-]{36}/);

    const credential = await repo.findCredentialByEmail(email);
    expect(credential).toEqual({ accountId, email, passwordHash });

    // The hash is persisted verbatim — this layer never re-hashes.
    expect(credential?.passwordHash).toBe(passwordHash);

    // And the account-email lookup resolves the same account.
    expect(await repo.findAccountEmail(accountId)).toBe(email);
  });

  it("rejects a duplicate email via the DB unique constraint (race guard)", async () => {
    const repo = new PostgresAuthRepository(pool);
    const email = uniqueEmail("dupe");
    await repo.createAccountWithCredential({ email, passwordHash: "scrypt$1$1$1$00$00" });

    await expect(
      repo.createAccountWithCredential({ email, passwordHash: "scrypt$1$1$1$11$11" }),
    ).rejects.toThrow();
  });

  it("creates, finds, and deletes a session by its token hash", async () => {
    const repo = new PostgresAuthRepository(pool);
    const { accountId } = await repo.createAccountWithCredential({
      email: uniqueEmail("session"),
      passwordHash: "scrypt$1$1$1$00$00",
    });

    const createdAt = new Date();
    const expiresAt = sessionExpiry(createdAt);
    const record = {
      id: crypto.randomUUID(),
      accountId,
      // A realistic 64-char hex SHA-256 token hash; stored verbatim, never raw.
      tokenHash: "a".repeat(64),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await repo.createSession(record);

    const found = await repo.findSessionByTokenHash(record.tokenHash);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(record.id);
    expect(found?.accountId).toBe(accountId);
    expect(found?.tokenHash).toBe(record.tokenHash);
    // Timestamps round-trip to the same instant.
    expect(new Date(found!.createdAt).getTime()).toBe(createdAt.getTime());
    expect(new Date(found!.expiresAt).getTime()).toBe(expiresAt.getTime());

    await repo.deleteSessionByTokenHash(record.tokenHash);
    expect(await repo.findSessionByTokenHash(record.tokenHash)).toBeNull();

    // Idempotent: deleting an absent token is not an error.
    await expect(
      repo.deleteSessionByTokenHash(record.tokenHash),
    ).resolves.toBeUndefined();
  });

  it("stores expiry verbatim so the service can interpret freshness", async () => {
    const repo = new PostgresAuthRepository(pool);
    const { accountId } = await repo.createAccountWithCredential({
      email: uniqueEmail("expiry"),
      passwordHash: "scrypt$1$1$1$00$00",
    });

    // An already-expired session: the repo still returns it (it does not filter
    // by expiry — the service prunes on read, mirroring the in-memory repo).
    const past = new Date(Date.now() - 60_000);
    const record = {
      id: crypto.randomUUID(),
      accountId,
      tokenHash: "b".repeat(64),
      createdAt: new Date(past.getTime() - 60_000).toISOString(),
      expiresAt: past.toISOString(),
    };
    await repo.createSession(record);

    const found = await repo.findSessionByTokenHash(record.tokenHash);
    expect(found).not.toBeNull();
    expect(new Date(found!.expiresAt).getTime()).toBe(past.getTime());
  });

  it("returns null for an unknown email, session, or account", async () => {
    const repo = new PostgresAuthRepository(pool);
    expect(await repo.findCredentialByEmail(uniqueEmail("missing"))).toBeNull();
    expect(await repo.findSessionByTokenHash("f".repeat(64))).toBeNull();
    expect(await repo.findAccountEmail(crypto.randomUUID())).toBeNull();
  });
});
