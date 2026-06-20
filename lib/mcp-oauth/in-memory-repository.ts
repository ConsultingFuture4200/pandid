/**
 * In-memory OAuthRepository (DEV-1147, FR-21).
 *
 * Test double for the OAuth service and a local-dev stand-in before the
 * Postgres-backed repository is wired (DEV-1135 pattern). NOT the production
 * store — `getOAuthRepository` (index.ts) refuses to serve it in production so
 * issued tokens are never an in-memory map that evaporates on restart.
 *
 * The `clients` map is seedable so tests (and DEV-1148's DCR before its own
 * persistence lands) can register a connector to authorize against.
 */
import type { OAuthRepository } from "./repository";
import type {
  AccessTokenRecord,
  AuthorizationCode,
  OAuthClient,
} from "./types";

export class InMemoryOAuthRepository implements OAuthRepository {
  private readonly clients = new Map<string, OAuthClient>();
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly tokens = new Map<string, AccessTokenRecord>();

  /** Seed a registered client (test/dev helper; DCR is DEV-1148's job). */
  seedClient(client: OAuthClient): void {
    this.clients.set(client.clientId, client);
  }

  async findClient(clientId: string): Promise<OAuthClient | null> {
    return this.clients.get(clientId) ?? null;
  }

  async createAuthorizationCode(code: AuthorizationCode): Promise<void> {
    this.codes.set(code.codeHash, code);
  }

  async consumeAuthorizationCode(
    codeHash: string,
  ): Promise<AuthorizationCode | null> {
    const code = this.codes.get(codeHash) ?? null;
    if (code !== null) {
      // Delete-on-read: a code is single-use, so a replay finds nothing.
      this.codes.delete(codeHash);
    }
    return code;
  }

  async createToken(token: AccessTokenRecord): Promise<void> {
    this.tokens.set(token.tokenHash, token);
  }

  async findTokenByHash(tokenHash: string): Promise<AccessTokenRecord | null> {
    return this.tokens.get(tokenHash) ?? null;
  }

  async deleteTokenByHash(tokenHash: string): Promise<void> {
    this.tokens.delete(tokenHash);
  }
}
