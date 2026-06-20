/**
 * Public surface of the account → active-diagram scoping module (DEV-1149).
 *
 * Consumers:
 *   - MCP server (DEV-1145) → `createScopingContextResolver` to resolve each
 *     `tools/call`'s account-scoped `TransportContext` (once DEV-1147/1148 inject
 *     a token extractor + token→account `AccountResolver`).
 *   - Web app server actions → `ScopingService.setActiveDiagram` / `.getActiveDiagram`
 *     so selecting a diagram in the browser rebinds the account's active diagram
 *     (PRD §2.2). The very next MCP tool call then targets the new diagram.
 *   - Tenant-isolation tests (DEV-1158) → the scoping service + repository.
 *
 * `getScopingRepository` serves an in-memory repository in dev/test and the
 * Postgres-backed one in production — and refuses the in-memory one in
 * production, so "which diagram is active" is never silently an in-process map
 * (CLAUDE.md: server is the single source of truth).
 */
import { getPool } from "@/lib/db/pool";
import { getDiagramRepository, getDiagramService } from "@/lib/diagram";
import { InMemoryScopingRepository } from "./in-memory-repository";
import { PostgresScopingRepository } from "./postgres-repository";
import { ScopingService, denyAllAccountResolver } from "./service";
import type { AccountResolver, ScopingRepository } from "./types";

export {
  ScopingError,
} from "./types";
export type {
  AccountResolver,
  ScopingErrorCode,
  ScopingRepository,
  TransportContext,
} from "./types";

export { ScopingService, denyAllAccountResolver } from "./service";
export { InMemoryScopingRepository } from "./in-memory-repository";
export { PostgresScopingRepository } from "./postgres-repository";
export { createScopingContextResolver } from "./context-resolver";
export type { TokenExtractor } from "./context-resolver";

let cachedRepository: ScopingRepository | null = null;

/**
 * Resolve the process-wide scoping repository.
 *
 * Production uses the Postgres-backed repository over the shared pool. Dev/test
 * use a singleton in-memory repository (sharing the in-memory diagram repository
 * so diagrams + their active flag stay consistent); production refuses the
 * in-memory one so canonical state is never an in-process map.
 */
export function getScopingRepository(): ScopingRepository {
  if (process.env.NODE_ENV === "production") {
    cachedRepository ??= new PostgresScopingRepository(getPool());
    return cachedRepository;
  }
  cachedRepository ??= new InMemoryScopingRepository(getDiagramRepository());
  return cachedRepository;
}

/**
 * Convenience: a `ScopingService` over the resolved repository + diagram service.
 *
 * The token→account `AccountResolver` defaults to deny-all until the OAuth chain
 * (DEV-1147/1148) injects a real one; callers that have one pass it explicitly.
 */
export function getScopingService(
  accounts: AccountResolver = denyAllAccountResolver,
): ScopingService {
  return new ScopingService(
    getScopingRepository(),
    getDiagramService(),
    accounts,
  );
}
