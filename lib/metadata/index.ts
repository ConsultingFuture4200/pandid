/**
 * Public surface of the element-metadata store (DEV-1136, FR-14).
 *
 * The parallel, element-id-keyed store for equipment metadata — the single source
 * of truth because `convertToExcalidrawElements` drops `customData` (CLAUDE.md
 * fact #1). Consumers:
 *   - canvas / palette (DEV-1137)     → ElementMetadataStore.attachToElements
 *   - commit pipeline (DEV-1140)      → set / setMany per new immutable version
 *   - line-list export (DEV-1156)     → list / attachToElements
 *   - set_metadata propose tool       → set (staged via proposals, never direct)
 *
 * The concrete Postgres-backed repository is wired by persistence (DEV-1135),
 * which owns the connection pool. Until then `getElementMetadataRepository` serves
 * an in-memory repository in dev/test and refuses to in production, so canonical
 * metadata is never silently an in-memory map (CLAUDE.md: real data only; server
 * is the single source of truth).
 */
import { getPool } from "@/lib/db/pool";
import { InMemoryElementMetadataRepository } from "./in-memory-repository";
import { PostgresElementMetadataRepository } from "./postgres-repository";
import type { ElementMetadataRepository } from "./repository";
import { ElementMetadataStore } from "./store";

export type { ElementMetadataRepository } from "./repository";
export { InMemoryElementMetadataRepository } from "./in-memory-repository";
export { PostgresElementMetadataRepository } from "./postgres-repository";
export { ElementMetadataStore } from "./store";
export {
  reattachMetadata,
  stripCustomData,
  indexByElementId,
} from "./reattach";
export type { ElementLike, ElementWithMetadata } from "./reattach";

let cachedRepository: ElementMetadataRepository | null = null;

/**
 * Resolve the process-wide element-metadata repository.
 *
 * Production uses the Postgres-backed repository over the shared pool. Dev/test
 * use a singleton in-memory repository; production refuses it so canonical
 * metadata is never lost to an in-process map (CLAUDE.md: real data only; server
 * is the single source of truth).
 */
export function getElementMetadataRepository(): ElementMetadataRepository {
  if (process.env.NODE_ENV === "production") {
    cachedRepository ??= new PostgresElementMetadataRepository(getPool());
    return cachedRepository;
  }
  cachedRepository ??= new InMemoryElementMetadataRepository();
  return cachedRepository;
}

/** Convenience: an `ElementMetadataStore` over the resolved repository. */
export function getElementMetadataStore(): ElementMetadataStore {
  return new ElementMetadataStore(getElementMetadataRepository());
}
