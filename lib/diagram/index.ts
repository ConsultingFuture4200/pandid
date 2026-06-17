/**
 * Public surface of the diagram persistence module (DEV-1135, FR-17–19, SC-6).
 *
 * Consumers:
 *   - server actions / dashboard (diagram list/open/rename/delete)
 *   - commit pipeline (DEV-1140)          → DiagramService.save
 *   - accepted proposals (DEV-1144)       → DiagramService.save
 *   - MCP active-diagram scoping (DEV-1149) → DiagramService read/save
 *
 * `getDiagramRepository` serves an in-memory repository in dev/test and the
 * Postgres-backed repository (over the shared pool) in production — and refuses
 * to serve the in-memory one in production, so canonical state is never silently
 * an in-memory map (CLAUDE.md: real data only; server is the single source of truth).
 */
import { getPool } from "@/lib/db/pool";
import { InMemoryDiagramRepository } from "./in-memory-repository";
import { PostgresDiagramRepository } from "./postgres-repository";
import type { DiagramRepository } from "./repository";
import { DiagramService } from "./service";

export { DiagramService } from "./service";
export {
  DiagramError,
  saveVersionInputSchema,
  versionSnapshotSchema,
  versionMetadataInputSchema,
} from "./types";
export type {
  DiagramErrorCode,
  DiagramWithVersions,
  SaveVersionInput,
  VersionMetadataInput,
  VersionSnapshot,
} from "./types";
export type { DiagramRepository } from "./repository";
export { InMemoryDiagramRepository } from "./in-memory-repository";
export { PostgresDiagramRepository } from "./postgres-repository";

let cachedRepository: DiagramRepository | null = null;

/**
 * Resolve the process-wide diagram repository.
 *
 * Production uses the Postgres-backed repository over the shared pool. Dev/test
 * use a singleton in-memory repository; production refuses it so accounts'
 * diagrams are never lost to an in-process map.
 */
export function getDiagramRepository(): DiagramRepository {
  if (process.env.NODE_ENV === "production") {
    cachedRepository ??= new PostgresDiagramRepository(getPool());
    return cachedRepository;
  }
  cachedRepository ??= new InMemoryDiagramRepository();
  return cachedRepository;
}

/** Convenience: a `DiagramService` over the resolved repository. */
export function getDiagramService(): DiagramService {
  return new DiagramService(getDiagramRepository());
}
