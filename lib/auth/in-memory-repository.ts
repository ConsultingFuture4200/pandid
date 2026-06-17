/**
 * In-memory AuthRepository (DEV-1134, FR-20).
 *
 * Test double for the auth service and a stand-in for local development before
 * the Postgres-backed repository is wired by persistence (DEV-1135). It is
 * NOT the production store — `getAuthRepository` (see `index.ts`) refuses to
 * hand this out in production so canonical state is never an in-memory map.
 */
import type { AuthRepository } from "./repository";
import type { AuthCredential, SessionRecord } from "./types";

export class InMemoryAuthRepository implements AuthRepository {
  private readonly credentials = new Map<string, AuthCredential>();
  private readonly emails = new Map<string, string>(); // accountId -> email
  private readonly sessions = new Map<string, SessionRecord>(); // tokenHash -> record

  async findCredentialByEmail(email: string): Promise<AuthCredential | null> {
    return this.credentials.get(email) ?? null;
  }

  async createAccountWithCredential(input: {
    email: string;
    passwordHash: string;
  }): Promise<{ accountId: string }> {
    if (this.credentials.has(input.email)) {
      throw new Error("email already registered");
    }
    const accountId = crypto.randomUUID();
    this.credentials.set(input.email, {
      accountId,
      email: input.email,
      passwordHash: input.passwordHash,
    });
    this.emails.set(accountId, input.email);
    return { accountId };
  }

  async createSession(record: SessionRecord): Promise<void> {
    this.sessions.set(record.tokenHash, record);
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<SessionRecord | null> {
    return this.sessions.get(tokenHash) ?? null;
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async findAccountEmail(accountId: string): Promise<string | null> {
    return this.emails.get(accountId) ?? null;
  }
}
