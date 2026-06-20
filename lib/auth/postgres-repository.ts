/**
 * Postgres-backed AuthRepository (DEV-1135, FR-20).
 *
 * The production auth store. Tables (`auth_credentials`, `sessions`) are owned by
 * the auth task (DEV-1134, migration 0002); the `account` row is owned by the
 * schema task (DEV-1132, migration 0001). This is data-access only — no DDL.
 *
 * Secret hygiene: this layer persists ALREADY-hashed values verbatim — the scrypt
 * password hash and the SHA-256 session token hash are produced upstream
 * (`password.ts` / `session.ts`). It never hashes, never sees a raw secret, and
 * never logs a credential or token hash.
 *
 * Session expiry mirrors the in-memory reference: rows are stored with their
 * `expires_at`; the service (`resolveSession`) decides freshness and prunes
 * expired rows via `deleteSessionByTokenHash`. This repository does not silently
 * filter expired sessions on read, so the service's prune-on-read stays the one
 * place expiry is interpreted.
 */
import type { Pool } from "pg";
import type { AuthRepository } from "./repository";
import type { AuthCredential, SessionRecord } from "./types";

interface CredentialRow {
  account_id: string;
  email: string;
  password_hash: string;
}

interface SessionRow {
  id: string;
  account_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

interface AccountEmailRow {
  email: string;
}

interface AccountIdRow {
  id: string;
}

function toCredential(row: CredentialRow): AuthCredential {
  return {
    accountId: row.account_id,
    email: row.email,
    passwordHash: row.password_hash,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: Pool) {}

  async findCredentialByEmail(email: string): Promise<AuthCredential | null> {
    const { rows } = await this.pool.query<CredentialRow>(
      `SELECT account_id, email, password_hash
       FROM auth_credentials
       WHERE email = $1`,
      [email],
    );
    return rows[0] ? toCredential(rows[0]) : null;
  }

  async createAccountWithCredential(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ accountId: string }> {
    // Account row + credential row in one transaction: a credential must never
    // exist without its account, and a half-created account must never linger.
    // The unique constraints on `account.email` / `auth_credentials.email` are
    // the real race guard against a concurrent signup (the service pre-checks).
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<AccountIdRow>(
        `INSERT INTO account (email)
         VALUES ($1)
         RETURNING id`,
        [input.email],
      );
      const accountId = account.rows[0].id;
      await client.query(
        `INSERT INTO auth_credentials (account_id, email, password_hash)
         VALUES ($1, $2, $3)`,
        [accountId, input.email, input.passwordHash],
      );
      await client.query("COMMIT");
      return { accountId };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async createSession(record: SessionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, account_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        record.id,
        record.accountId,
        record.tokenHash,
        record.createdAt,
        record.expiresAt,
      ],
    );
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<SessionRecord | null> {
    const { rows } = await this.pool.query<SessionRow>(
      `SELECT id, account_id, token_hash, created_at, expires_at
       FROM sessions
       WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    // Idempotent: deleting an absent token is not an error (matches in-memory).
    await this.pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [
      tokenHash,
    ]);
  }

  async findAccountEmail(accountId: string): Promise<string | null> {
    const { rows } = await this.pool.query<AccountEmailRow>(
      `SELECT email FROM account WHERE id = $1`,
      [accountId],
    );
    return rows[0] ? rows[0].email : null;
  }
}
