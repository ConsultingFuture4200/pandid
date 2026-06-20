/**
 * Public surface of the MCP OAuth provider (DEV-1147, FR-21).
 *
 * Consumers:
 *   - the OAuth route handlers (app/api/mcp/oauth/*, app/.well-known/*) — the
 *     authorization + token endpoints and discovery metadata.
 *   - DEV-1148 (DCR) — registers clients into the same `OAuthRepository` and
 *     reuses `OAuthService` issuance; it adds `createClient`, never re-models
 *     tokens.
 *   - DEV-1145's `ContextResolver` + DEV-1149's active-diagram scoping —
 *     `resolveOAuthPrincipal` turns a request's bearer token into an account.
 *
 * In production the Postgres-backed repository is built over the shared pool
 * (`@/lib/db/pool`). Dev/test keep a singleton in-memory store, so issued tokens
 * are never silently an in-memory map in production (CLAUDE.md: real data only;
 * server is the single source of truth).
 */
import { getPool } from "@/lib/db/pool";
import { InMemoryOAuthRepository } from "./in-memory-repository";
import { PostgresOAuthRepository } from "./postgres-repository";
import type { OAuthRepository } from "./repository";
import { OAuthService } from "./service";

export { OAuthService } from "./service";
export type { AuthorizationResult } from "./service";
export { OAuthError } from "./types";
export {
  MCP_OAUTH_SCOPE,
  CODE_CHALLENGE_METHOD,
  authorizationRequestSchema,
  tokenRequestSchema,
} from "./types";
export type {
  AccessTokenRecord,
  AuthorizationCode,
  AuthorizationRequest,
  OAuthClient,
  OAuthErrorCode,
  OAuthPrincipal,
  TokenKind,
  TokenRequest,
  TokenResponse,
} from "./types";
export type { OAuthRepository } from "./repository";
export { InMemoryOAuthRepository } from "./in-memory-repository";
export { PostgresOAuthRepository } from "./postgres-repository";
export {
  bearerTokenFromHeader,
  resolveOAuthPrincipal,
} from "./resolve-principal";
export {
  authorizationServerMetadata,
  protectedResourceMetadata,
  originFromRequest,
} from "./metadata";
export type {
  AuthorizationServerMetadata,
  ProtectedResourceMetadata,
} from "./metadata";

let cachedRepository: OAuthRepository | null = null;

/**
 * Resolve the process-wide OAuth repository.
 *
 * Production gets the Postgres-backed repository over the shared pool, so issued
 * codes/tokens persist across restarts and stay the single source of truth.
 * Dev/test get a singleton in-memory repository. The chosen instance is cached
 * process-wide either way.
 */
export function getOAuthRepository(): OAuthRepository {
  cachedRepository ??=
    process.env.NODE_ENV === "production"
      ? new PostgresOAuthRepository(getPool())
      : new InMemoryOAuthRepository();
  return cachedRepository;
}

/** Convenience: an `OAuthService` over the resolved repository. */
export function getOAuthService(): OAuthService {
  return new OAuthService(getOAuthRepository());
}
