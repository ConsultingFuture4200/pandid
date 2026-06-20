/**
 * Public surface of the web-login auth module (DEV-1134, FR-20).
 *
 * Consumers:
 *   - server actions (`app/(auth)/actions.ts`) → AuthService, cookie helpers
 *   - middleware (`middleware.ts`)             → resolveSession via the service
 *   - connector binding (DEV-1147/1149)        → AuthService.resolveSession
 *
 * The concrete Postgres-backed repository is wired by persistence (DEV-1135),
 * which owns the connection pool. Until then `getAuthRepository` serves an
 * in-memory repository in dev/test and refuses to do so in production, so
 * canonical state is never silently an in-memory map (CLAUDE.md: real data
 * only; server is the single source of truth).
 */
import { getPool } from "@/lib/db/pool";
import { InMemoryAuthRepository } from "./in-memory-repository";
import { PostgresAuthRepository } from "./postgres-repository";
import type { AuthRepository } from "./repository";
import { AuthService } from "./service";

export { AuthService } from "./service";
export type { AuthSession } from "./service";
export { AuthError } from "./types";
export type {
  AuthErrorCode,
  AuthenticatedUser,
  Credentials,
} from "./types";
export { credentialsSchema } from "./types";
export {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  sessionExpiry,
} from "./session";
export { MIN_PASSWORD_LENGTH } from "./password";
export {
  DEFAULT_POST_LOGIN_PATH,
  isSafeNextPath,
  safeNextPath,
} from "./safe-next";
export type { AuthRepository } from "./repository";
export { InMemoryAuthRepository } from "./in-memory-repository";
export { PostgresAuthRepository } from "./postgres-repository";

let cachedRepository: AuthRepository | null = null;

/**
 * Resolve the process-wide auth repository.
 *
 * Production uses the Postgres-backed repository over the shared pool. Dev/test
 * use a singleton in-memory repository; production refuses it so accounts and
 * sessions are never lost to an in-process map (CLAUDE.md: real data only;
 * server is the single source of truth).
 */
export function getAuthRepository(): AuthRepository {
  if (process.env.NODE_ENV === "production") {
    cachedRepository ??= new PostgresAuthRepository(getPool());
    return cachedRepository;
  }
  cachedRepository ??= new InMemoryAuthRepository();
  return cachedRepository;
}

/** Convenience: an `AuthService` over the resolved repository. */
export function getAuthService(): AuthService {
  return new AuthService(getAuthRepository());
}
