/**
 * MCP OAuth persistence interface (DEV-1147, FR-21).
 *
 * The service depends on this interface, never on a concrete driver — so the
 * OAuth flow is unit-testable with an in-memory implementation and the real
 * Postgres-backed implementation (wired where the pool lives, DEV-1135 pattern)
 * is a drop-in.
 *
 * DCR boundary (DEV-1148): client registration is NOT in this interface's write
 * surface. `findClient` is read-only here; DEV-1148 adds `createClient` beside
 * it. Keeping the seam explicit means issuance/validation never change when DCR
 * lands.
 *
 * Server is the single source of truth (CLAUDE.md invariant): every client,
 * authorization code, and token read/write goes through this one surface.
 */
import type {
  AccessTokenRecord,
  AuthorizationCode,
  OAuthClient,
} from "./types";

export interface OAuthRepository {
  /**
   * Look up a registered client by id, or null if unknown. Read-only here;
   * DCR (DEV-1148) owns client creation. An unknown client at /authorize or
   * /token is an `invalid_client`.
   */
  findClient(clientId: string): Promise<OAuthClient | null>;

  /** Persist a freshly-issued authorization code (single-use). */
  createAuthorizationCode(code: AuthorizationCode): Promise<void>;

  /**
   * Atomically fetch-and-delete an authorization code by its hash. Returns the
   * record if present (and removes it so it can't be replayed), or null if
   * absent/already-redeemed. The delete-on-read is what makes a code single-use.
   */
  consumeAuthorizationCode(codeHash: string): Promise<AuthorizationCode | null>;

  /** Persist a freshly-issued access or refresh token (stored hashed). */
  createToken(token: AccessTokenRecord): Promise<void>;

  /** Resolve a token by its hash, or null if absent. */
  findTokenByHash(tokenHash: string): Promise<AccessTokenRecord | null>;

  /** Delete a token by hash. Idempotent — absent is not an error. */
  deleteTokenByHash(tokenHash: string): Promise<void>;
}
