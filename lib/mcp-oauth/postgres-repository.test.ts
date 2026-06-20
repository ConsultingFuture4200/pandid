/**
 * PostgresOAuthRepository integration test (DEV-1147, FR-21).
 *
 * Runs against a REAL, ephemeral Postgres — no mocks, no fallbacks (project
 * policy: real data sources only). A throwaway `postgres:16-alpine` container is
 * started for the suite and torn down after; the real migrations build the
 * schema, so `oauth_authorization_codes` + `oauth_tokens` (migration 0004) and
 * their FKs to `oauth_clients` (0003) + `account` (0001) are the production ones.
 *
 * Proves the persistence acceptance against the real DB: client lookup,
 * single-use auth codes (consume deletes the row), access/refresh token
 * round-trip including the null expiry for refresh tokens, find-by-hash, and
 * idempotent delete. The semantics mirror `InMemoryOAuthRepository` exactly (it
 * is the reference spec). Expiry is the service's concern, not the repo's, so
 * `consumeAuthorizationCode` returns even an expired row.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrateUp } from "@/db/migrate";
import type { AccessTokenRecord, AuthorizationCode } from "./types";
import { PostgresOAuthRepository } from "./postgres-repository";

const exec = promisify(execFile);

const CONTAINER_NAME = `pid-mcp-oauth-test-${process.pid}`;
const PG_PASSWORD = "test";
const PG_DB = "pid_coeditor_test";

let hostPort: number;
let pool: Pool;
let accountId: string;
let clientId: string;

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

/** Insert a client row directly (DCR owns the table; we only need a FK target). */
async function seedClient(): Promise<string> {
  const id = `client-${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO oauth_clients (
       id, client_id, client_secret_hash, redirect_uris, grant_types,
       response_types, token_endpoint_auth_method
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      id,
      null,
      ["https://claude.ai/callback"],
      ["authorization_code", "refresh_token"],
      ["code"],
      "none",
    ],
  );
  return id;
}

function makeCode(overrides: Partial<AuthorizationCode> = {}): AuthorizationCode {
  const now = new Date();
  return {
    codeHash: "c".repeat(64),
    clientId,
    accountId,
    redirectUri: "https://claude.ai/callback",
    codeChallenge: "challenge-base64url",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

function makeToken(overrides: Partial<AccessTokenRecord> = {}): AccessTokenRecord {
  const now = new Date();
  return {
    tokenHash: "t".repeat(64),
    kind: "access",
    clientId,
    accountId,
    scope: "mcp",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  if (!(await dockerAvailable())) {
    throw new Error(
      "Docker is required to run MCP OAuth persistence integration tests (real Postgres, no mocks). " +
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

beforeEach(async () => {
  // Fresh account + client per test so codes/tokens (unique by hash PK) don't
  // collide and FK targets exist.
  const a = await pool.query<{ id: string }>(
    "INSERT INTO account (email) VALUES ($1) RETURNING id",
    [`owner-${Date.now()}-${Math.random()}@example.com`],
  );
  accountId = a.rows[0].id;
  clientId = await seedClient();
});

describe("PostgresOAuthRepository — clients", () => {
  it("finds a registered client and returns null for an unknown one", async () => {
    const repo = new PostgresOAuthRepository(pool);

    const found = await repo.findClient(clientId);
    expect(found?.clientId).toBe(clientId);
    expect(found?.redirectUris).toEqual(["https://claude.ai/callback"]);

    expect(await repo.findClient(`missing-${crypto.randomUUID()}`)).toBeNull();
  });
});

describe("PostgresOAuthRepository — authorization codes", () => {
  it("stores and consumes a code exactly once (single-use)", async () => {
    const repo = new PostgresOAuthRepository(pool);
    const code = makeCode({ codeHash: `code-${crypto.randomUUID()}`.padEnd(64, "0").slice(0, 64) });

    await repo.createAuthorizationCode(code);

    const first = await repo.consumeAuthorizationCode(code.codeHash);
    expect(first).not.toBeNull();
    expect(first?.clientId).toBe(clientId);
    expect(first?.accountId).toBe(accountId);
    expect(first?.redirectUri).toBe(code.redirectUri);
    expect(first?.codeChallenge).toBe(code.codeChallenge);
    expect(new Date(first!.expiresAt).getTime()).toBe(
      new Date(code.expiresAt).getTime(),
    );

    // Delete-on-read: a replay finds nothing.
    expect(await repo.consumeAuthorizationCode(code.codeHash)).toBeNull();
  });

  it("returns an expired code (expiry is the service's check, not the repo's)", async () => {
    const repo = new PostgresOAuthRepository(pool);
    const expired = makeCode({
      codeHash: `exp-${crypto.randomUUID()}`.padEnd(64, "0").slice(0, 64),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await repo.createAuthorizationCode(expired);
    const consumed = await repo.consumeAuthorizationCode(expired.codeHash);
    expect(consumed).not.toBeNull();
  });

  it("returns null when consuming an unknown code", async () => {
    const repo = new PostgresOAuthRepository(pool);
    expect(
      await repo.consumeAuthorizationCode("f".repeat(64)),
    ).toBeNull();
  });
});

describe("PostgresOAuthRepository — tokens", () => {
  it("stores an access token and resolves it by hash", async () => {
    const repo = new PostgresOAuthRepository(pool);
    const token = makeToken({ tokenHash: "1".repeat(64) });

    await repo.createToken(token);
    const found = await repo.findTokenByHash(token.tokenHash);

    expect(found?.tokenHash).toBe(token.tokenHash);
    expect(found?.kind).toBe("access");
    expect(found?.clientId).toBe(clientId);
    expect(found?.accountId).toBe(accountId);
    expect(found?.scope).toBe("mcp");
    expect(found?.expiresAt).not.toBeNull();
    expect(new Date(found!.expiresAt as string).getTime()).toBe(
      new Date(token.expiresAt as string).getTime(),
    );
  });

  it("stores a long-lived refresh token with null expiry", async () => {
    const repo = new PostgresOAuthRepository(pool);
    const refresh = makeToken({
      tokenHash: "2".repeat(64),
      kind: "refresh",
      expiresAt: null,
    });

    await repo.createToken(refresh);
    const found = await repo.findTokenByHash(refresh.tokenHash);

    expect(found?.kind).toBe("refresh");
    expect(found?.expiresAt).toBeNull();
  });

  it("returns null for an unknown token hash", async () => {
    const repo = new PostgresOAuthRepository(pool);
    expect(await repo.findTokenByHash("9".repeat(64))).toBeNull();
  });

  it("deletes a token (find then returns null) and is idempotent", async () => {
    const repo = new PostgresOAuthRepository(pool);
    const token = makeToken({ tokenHash: "3".repeat(64) });

    await repo.createToken(token);
    expect(await repo.findTokenByHash(token.tokenHash)).not.toBeNull();

    await repo.deleteTokenByHash(token.tokenHash);
    expect(await repo.findTokenByHash(token.tokenHash)).toBeNull();

    // Idempotent: deleting an absent token is not an error.
    await expect(repo.deleteTokenByHash(token.tokenHash)).resolves.toBeUndefined();
  });
});
