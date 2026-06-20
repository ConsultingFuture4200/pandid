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
 * The Postgres-backed repository is wired where the connection pool lives
 * (DEV-1135 pattern). Until then `getOAuthRepository` serves an in-memory store
 * in dev/test and refuses to in production, so issued tokens are never silently
 * an in-memory map (CLAUDE.md: real data only; server is the single source of
 * truth).
 */
import { InMemoryOAuthRepository } from "./in-memory-repository";
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
 * Dev/test get a singleton in-memory repository. In production an in-memory
 * token store would evaporate on restart and diverge from canonical truth, so
 * this throws until the Postgres-backed repository is wired here (DEV-1135
 * delivers the pool; the persistence-backed `OAuthRepository` lands beside it).
 */
export function getOAuthRepository(): OAuthRepository {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No persistent OAuthRepository is wired. The Postgres-backed repository " +
        "is delivered alongside the persistence task (DEV-1135); wire it in " +
        "lib/mcp-oauth/index.ts before running in production.",
    );
  }
  cachedRepository ??= new InMemoryOAuthRepository();
  return cachedRepository;
}

/** Convenience: an `OAuthService` over the resolved repository. */
export function getOAuthService(): OAuthService {
  return new OAuthService(getOAuthRepository());
}
