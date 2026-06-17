/**
 * Auth persistence interface (DEV-1134, FR-20).
 *
 * The service layer depends on this interface, never on a concrete driver, so
 * auth logic is unit-testable with an in-memory implementation and the real
 * Postgres-backed implementation (DEV-1135 persistence wires the pool) is a
 * drop-in. Keeps the auth task from owning DB-connection code that belongs to
 * persistence.
 *
 * Server is the single source of truth (CLAUDE.md invariant): every account /
 * credential / session read and write goes through this one surface.
 */
import type { AuthCredential, SessionRecord } from "./types";

export interface AuthRepository {
  /** Look up a credential by email, or null if no account uses that email. */
  findCredentialByEmail(email: string): Promise<AuthCredential | null>;

  /**
   * Create an account row and its credential atomically.
   * @returns the new account id.
   * @throws if the email is already taken (the service pre-checks, but the DB
   *   unique constraint is the real guard against a race).
   */
  createAccountWithCredential(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ accountId: string }>;

  /** Persist a new session record. */
  createSession(record: SessionRecord): Promise<void>;

  /** Resolve a session by its token hash, or null if absent. */
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;

  /** Delete a session by token hash. Idempotent — absent is not an error. */
  deleteSessionByTokenHash(tokenHash: string): Promise<void>;

  /** Look up an account's email by id, or null if absent. */
  findAccountEmail(accountId: string): Promise<string | null>;
}
