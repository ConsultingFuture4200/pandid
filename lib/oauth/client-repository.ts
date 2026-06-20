/**
 * OAuth client persistence interface (DEV-1148 / 15b, FR-21).
 *
 * The DCR service depends on this interface, never on a concrete driver, so
 * registration + client-validity logic is unit-testable with an in-memory
 * implementation and the real Postgres-backed implementation (wired where the
 * persistence task owns the pool) is a drop-in. Keeps this task from owning
 * DB-connection code.
 *
 * Server is the single source of truth (CLAUDE.md invariant): every registered
 * client read and write goes through this one surface. The token endpoint
 * (DEV-1147) resolves a client through `findByClientId` here before issuing a
 * token; a `null` result is what produces the 401 invalid_client re-register
 * signal.
 */
import type { OAuthClientRecord } from "./types";

export interface OAuthClientRepository {
  /** Persist a newly registered client. */
  createClient(record: OAuthClientRecord): Promise<void>;

  /**
   * Resolve a registered client by its public `client_id`, or null when no
   * such client exists (never registered, or revoked/deleted). A null here is
   * what the token endpoint turns into a 401 invalid_client → re-register.
   */
  findByClientId(clientId: string): Promise<OAuthClientRecord | null>;

  /**
   * Delete a registered client by `client_id`. Idempotent — absent is not an
   * error. After deletion, `findByClientId` returns null, so the next token
   * request for that client gets 401 invalid_client and the client re-registers.
   */
  deleteByClientId(clientId: string): Promise<void>;
}
