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
import { InMemoryAuthRepository } from "./in-memory-repository";
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
export type { AuthRepository } from "./repository";
export { InMemoryAuthRepository } from "./in-memory-repository";

let cachedRepository: AuthRepository | null = null;

/**
 * Resolve the process-wide auth repository.
 *
 * Dev/test get a singleton in-memory repository. In production an in-memory
 * store would silently lose accounts and diverge from canonical truth, so this
 * throws until DEV-1135 wires the Postgres-backed repository here.
 */
export function getAuthRepository(): AuthRepository {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No persistent AuthRepository is wired. The Postgres-backed repository " +
        "is delivered by the persistence task (DEV-1135); wire it in " +
        "lib/auth/index.ts before running in production.",
    );
  }
  cachedRepository ??= new InMemoryAuthRepository();
  return cachedRepository;
}

/** Convenience: an `AuthService` over the resolved repository. */
export function getAuthService(): AuthService {
  return new AuthService(getAuthRepository());
}
