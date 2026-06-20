/**
 * Postgres-backed OAuthRepository (DEV-1147, FR-21).
 *
 * The production store for the MCP authorization server: registered clients
 * (read-only here; DCR owns writes), single-use authorization codes, and
 * access/refresh tokens. Operates on `oauth_clients` (migration 0003),
 * `oauth_authorization_codes` + `oauth_tokens` (migration 0004) — data-access
 * only, no DDL. Drop-in for `InMemoryOAuthRepository`: same semantics,
 * persistent.
 *
 * Secrets at rest: codes and tokens are persisted already-hashed (SHA-256 hex)
 * by the service layer (`lib/mcp-oauth/service.ts` + `tokens.ts`). This repo
 * stores and looks up by that hash; it never hashes, re-hashes, or logs a raw
 * code/token (CLAUDE.md: tokens stay hashed at rest).
 *
 * Single-use codes: `consumeAuthorizationCode` is an atomic DELETE … RETURNING,
 * so a redemption removes the row in the same statement that reads it — a replay
 * finds nothing. Expiry is enforced by the service, not silently here, mirroring
 * the in-memory reference (it returns the row regardless of expiry; the service
 * checks `expiresAt`).
 *
 * Revoke/rotate on refresh is the service's job: it issues a fresh token pair
 * (two `createToken` calls) and deletes spent tokens via `deleteTokenByHash`.
 * This repo only persists/looks-up/deletes — it owns no rotation policy.
 */
import type { Pool } from "pg";
import type { OAuthRepository } from "./repository";
import type {
  AccessTokenRecord,
  AuthorizationCode,
  OAuthClient,
  TokenKind,
} from "./types";

interface OAuthClientRow {
  client_id: string;
  redirect_uris: string[];
  created_at: Date;
}

interface AuthorizationCodeRow {
  code_hash: string;
  client_id: string;
  account_id: string;
  redirect_uri: string;
  code_challenge: string;
  created_at: Date;
  expires_at: Date;
}

interface TokenRow {
  token_hash: string;
  kind: TokenKind;
  client_id: string;
  account_id: string;
  scope: string;
  created_at: Date;
  expires_at: Date | null;
}

function toClient(row: OAuthClientRow): OAuthClient {
  return {
    clientId: row.client_id,
    redirectUris: row.redirect_uris,
    createdAt: row.created_at.toISOString(),
  };
}

function toAuthorizationCode(row: AuthorizationCodeRow): AuthorizationCode {
  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    accountId: row.account_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

function toToken(row: TokenRow): AccessTokenRecord {
  return {
    tokenHash: row.token_hash,
    kind: row.kind,
    clientId: row.client_id,
    accountId: row.account_id,
    scope: row.scope,
    createdAt: row.created_at.toISOString(),
    // `expires_at` is NULL for long-lived refresh tokens.
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
  };
}

export class PostgresOAuthRepository implements OAuthRepository {
  constructor(private readonly pool: Pool) {}

  async findClient(clientId: string): Promise<OAuthClient | null> {
    // Read-only view of the DCR-owned `oauth_clients` table. Only the columns
    // this provider needs to validate authorize/token requests.
    const { rows } = await this.pool.query<OAuthClientRow>(
      `SELECT client_id, redirect_uris, created_at
       FROM oauth_clients
       WHERE client_id = $1`,
      [clientId],
    );
    return rows[0] ? toClient(rows[0]) : null;
  }

  async createAuthorizationCode(code: AuthorizationCode): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_authorization_codes (
         code_hash, client_id, account_id, redirect_uri, code_challenge,
         created_at, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        code.codeHash,
        code.clientId,
        code.accountId,
        code.redirectUri,
        code.codeChallenge,
        code.createdAt,
        code.expiresAt,
      ],
    );
  }

  async consumeAuthorizationCode(
    codeHash: string,
  ): Promise<AuthorizationCode | null> {
    // Atomic fetch-and-delete: a code is single-use, so the redeeming statement
    // removes it as it reads it. A concurrent replay matches no row → null.
    const { rows } = await this.pool.query<AuthorizationCodeRow>(
      `DELETE FROM oauth_authorization_codes
       WHERE code_hash = $1
       RETURNING code_hash, client_id, account_id, redirect_uri, code_challenge,
                 created_at, expires_at`,
      [codeHash],
    );
    return rows[0] ? toAuthorizationCode(rows[0]) : null;
  }

  async createToken(token: AccessTokenRecord): Promise<void> {
    // Persist the already-hashed token verbatim; never re-hash here.
    await this.pool.query(
      `INSERT INTO oauth_tokens (
         token_hash, kind, client_id, account_id, scope, created_at, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        token.tokenHash,
        token.kind,
        token.clientId,
        token.accountId,
        token.scope,
        token.createdAt,
        token.expiresAt,
      ],
    );
  }

  async findTokenByHash(tokenHash: string): Promise<AccessTokenRecord | null> {
    const { rows } = await this.pool.query<TokenRow>(
      `SELECT token_hash, kind, client_id, account_id, scope, created_at,
              expires_at
       FROM oauth_tokens
       WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ? toToken(rows[0]) : null;
  }

  async deleteTokenByHash(tokenHash: string): Promise<void> {
    // Idempotent: absent is not an error. Backs both expiry pruning and the
    // service's revoke-on-refresh.
    await this.pool.query(`DELETE FROM oauth_tokens WHERE token_hash = $1`, [
      tokenHash,
    ]);
  }
}
