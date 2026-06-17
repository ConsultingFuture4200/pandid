/**
 * Element-metadata persistence interface (DEV-1136, FR-14).
 *
 * The parallel, element-id-keyed store for equipment metadata. It exists because
 * `convertToExcalidrawElements` DROPS `customData` (CLAUDE.md fact #1), so tag /
 * equipment-type / type-specific attributes can never ride on the Excalidraw
 * element — they live here, keyed by `(diagramVersionId, elementId)`, and are the
 * single source of truth for metadata.
 *
 * The store layer depends on this interface, never on a concrete driver, so it is
 * unit-testable with an in-memory implementation while the real Postgres-backed
 * implementation (wired by persistence, DEV-1135, which owns the connection pool)
 * drops in unchanged. This keeps the metadata task from owning DB-connection code
 * that belongs to persistence.
 *
 * Server is the single source of truth (CLAUDE.md invariant): every metadata read
 * and write goes through this one surface. Versions are immutable — metadata is
 * written per `diagramVersionId`; the commit pipeline (DEV-1140) snapshots a fresh
 * set against each new version rather than mutating a prior version's rows.
 */
import type { ElementMetadata } from "@/lib/types";

export interface ElementMetadataRepository {
  /**
   * Upsert one metadata record. Keyed by `(diagramVersionId, elementId)`: writing
   * the same key replaces the prior record for that key within the version.
   */
  upsert(record: ElementMetadata): Promise<void>;

  /**
   * Upsert many records for a single version in one call. Used when snapshotting a
   * whole version's metadata at commit time.
   */
  upsertMany(records: readonly ElementMetadata[]): Promise<void>;

  /** Resolve one record by its composite key, or null if absent. */
  find(
    diagramVersionId: string,
    elementId: string,
  ): Promise<ElementMetadata | null>;

  /** All metadata records for a version, in no guaranteed order. */
  listByVersion(diagramVersionId: string): Promise<ElementMetadata[]>;

  /**
   * Delete one record by its composite key. Idempotent — deleting an absent key is
   * not an error. Returns whether a record was removed.
   */
  delete(diagramVersionId: string, elementId: string): Promise<boolean>;
}
