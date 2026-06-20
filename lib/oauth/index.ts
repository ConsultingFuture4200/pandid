/**
 * Public surface of the OAuth Dynamic Client Registration module
 * (DEV-1148 / 15b, FR-21, PRD §5.6).
 *
 * Consumers:
 *   - registration route (`app/api/oauth/register/route.ts`) → DcrService.register
 *   - token endpoint (DEV-1147)                              → DcrService.assertClientValid
 *
 * The concrete Postgres-backed repository is wired by persistence (which owns
 * the connection pool). Until then `getOAuthClientRepository` serves an
 * in-memory repository in dev/test and refuses to do so in production, so
 * registered clients are never silently an in-memory map (CLAUDE.md: real data
 * only; server is the single source of truth).
 */
import { InMemoryOAuthClientRepository } from "./in-memory-client-repository";
import type { OAuthClientRepository } from "./client-repository";
import { DcrService } from "./dcr";

export { DcrService, hashClientSecret } from "./dcr";
export { OAuthError } from "./types";
export {
  INVALID_CLIENT_STATUS,
  INVALID_CLIENT_METADATA_STATUS,
  clientRegistrationRequestSchema,
  oauthClientRecordSchema,
} from "./types";
export type {
  OAuthErrorCode,
  OAuthClientRecord,
  ClientRegistrationRequest,
  ClientRegistrationResponse,
} from "./types";
export type { OAuthClientRepository } from "./client-repository";
export { InMemoryOAuthClientRepository } from "./in-memory-client-repository";

let cachedRepository: OAuthClientRepository | null = null;

/**
 * Resolve the process-wide OAuth client repository.
 *
 * Dev/test get a singleton in-memory repository. In production an in-memory
 * store would forget every registration on restart and diverge from canonical
 * truth, so this throws until the Postgres-backed repository is wired here.
 */
export function getOAuthClientRepository(): OAuthClientRepository {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No persistent OAuthClientRepository is wired. The Postgres-backed " +
        "repository (migration 0003_oauth_clients) must be connected in " +
        "lib/oauth/index.ts before running in production.",
    );
  }
  cachedRepository ??= new InMemoryOAuthClientRepository();
  return cachedRepository;
}

/** Convenience: a `DcrService` over the resolved client repository. */
export function getDcrService(): DcrService {
  return new DcrService(getOAuthClientRepository());
}
