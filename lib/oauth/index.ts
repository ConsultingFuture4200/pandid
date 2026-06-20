/**
 * Public surface of the OAuth Dynamic Client Registration module
 * (DEV-1148 / 15b, FR-21, PRD §5.6).
 *
 * Consumers:
 *   - registration route (`app/api/oauth/register/route.ts`) → DcrService.register
 *   - token endpoint (DEV-1147)                              → DcrService.assertClientValid
 *
 * In production the Postgres-backed repository is built over the shared pool
 * (`@/lib/db/pool`). Dev/test keep a singleton in-memory repository, so
 * registered clients are never silently an in-memory map in production
 * (CLAUDE.md: real data only; server is the single source of truth).
 */
import { getPool } from "@/lib/db/pool";
import { InMemoryOAuthClientRepository } from "./in-memory-client-repository";
import { PostgresOAuthClientRepository } from "./postgres-client-repository";
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
export { PostgresOAuthClientRepository } from "./postgres-client-repository";

let cachedRepository: OAuthClientRepository | null = null;

/**
 * Resolve the process-wide OAuth client repository.
 *
 * Production gets the Postgres-backed repository over the shared pool, so
 * registrations persist across restarts and stay the single source of truth.
 * Dev/test get a singleton in-memory repository. The chosen instance is cached
 * process-wide either way.
 */
export function getOAuthClientRepository(): OAuthClientRepository {
  cachedRepository ??=
    process.env.NODE_ENV === "production"
      ? new PostgresOAuthClientRepository(getPool())
      : new InMemoryOAuthClientRepository();
  return cachedRepository;
}

/** Convenience: a `DcrService` over the resolved client repository. */
export function getDcrService(): DcrService {
  return new DcrService(getOAuthClientRepository());
}
