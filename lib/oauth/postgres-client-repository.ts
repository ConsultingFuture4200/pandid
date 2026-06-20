/**
 * Postgres-backed OAuthClientRepository (DEV-1148 / 15b, FR-21, PRD §5.6).
 *
 * The production store for registered OAuth clients (RFC 7591). Operates on the
 * `oauth_clients` table (migration 0003_oauth_clients) — data-access only, no
 * DDL. Drop-in for `InMemoryOAuthClientRepository`: same semantics, persistent.
 *
 * Secrets at rest: `client_secret_hash` is the already-hashed value the DCR
 * service hands us (SHA-256 hex, or null for a public client). This repo never
 * hashes, re-hashes, or logs a raw secret — it persists exactly what it is
 * given (CLAUDE.md: secrets stay hashed at rest; the service layer owns hashing).
 *
 * `findByClientId` returns null for an unknown/deleted client, which the token
 * endpoint turns into 401 invalid_client → the client re-registers.
 */
import type { Pool } from "pg";
import type { OAuthClientRepository } from "./client-repository";
import type { OAuthClientRecord } from "./types";

interface OAuthClientRow {
  id: string;
  client_id: string;
  client_secret_hash: string | null;
  redirect_uris: string[];
  client_name: string | null;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string | null;
  created_at: Date;
}

function toRecord(row: OAuthClientRow): OAuthClientRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash,
    redirectUris: row.redirect_uris,
    clientName: row.client_name,
    grantTypes: row.grant_types,
    responseTypes: row.response_types,
    tokenEndpointAuthMethod: row.token_endpoint_auth_method,
    scope: row.scope,
    createdAt: row.created_at.toISOString(),
  };
}

export class PostgresOAuthClientRepository implements OAuthClientRepository {
  constructor(private readonly pool: Pool) {}

  async createClient(record: OAuthClientRecord): Promise<void> {
    // Persist the already-hashed secret verbatim; never re-hash here. The array
    // columns (redirect_uris, grant_types, response_types) are TEXT[] — pg binds
    // a JS array to a Postgres array directly.
    await this.pool.query(
      `INSERT INTO oauth_clients (
         id, client_id, client_secret_hash, redirect_uris, client_name,
         grant_types, response_types, token_endpoint_auth_method, scope, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        record.id,
        record.clientId,
        record.clientSecretHash,
        // Copy readonly arrays into mutable ones for the driver.
        [...record.redirectUris],
        record.clientName,
        [...record.grantTypes],
        [...record.responseTypes],
        record.tokenEndpointAuthMethod,
        record.scope,
        record.createdAt,
      ],
    );
  }

  async findByClientId(clientId: string): Promise<OAuthClientRecord | null> {
    const { rows } = await this.pool.query<OAuthClientRow>(
      `SELECT id, client_id, client_secret_hash, redirect_uris, client_name,
              grant_types, response_types, token_endpoint_auth_method, scope,
              created_at
       FROM oauth_clients
       WHERE client_id = $1`,
      [clientId],
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async deleteByClientId(clientId: string): Promise<void> {
    // Idempotent: absent is not an error, matching the in-memory delete.
    await this.pool.query(`DELETE FROM oauth_clients WHERE client_id = $1`, [
      clientId,
    ]);
  }
}
