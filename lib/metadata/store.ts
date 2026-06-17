/**
 * Element-metadata store service (DEV-1136, FR-14).
 *
 * Cohesive API over the `ElementMetadataRepository`: CRUD on records keyed by
 * `(diagramVersionId, elementId)` plus the convert round-trip helper that
 * re-attaches stored metadata to elements after `convertToExcalidrawElements`
 * drops their `customData` (CLAUDE.md fact #1).
 *
 * This is the single surface other tasks consume — the canvas (DEV-1137), the
 * commit pipeline (DEV-1140), and line-list export (DEV-1156) all read/write
 * metadata through here, never through `customData` and never by reaching into the
 * repository directly. Inputs are validated through `elementMetadataSchema`
 * (Zod at all boundaries) before they reach the store.
 */
import { elementMetadataSchema, type ElementMetadata } from "@/lib/types";
import type { ElementMetadataRepository } from "./repository";
import {
  reattachMetadata,
  type ElementLike,
  type ElementWithMetadata,
} from "./reattach";

export class ElementMetadataStore {
  constructor(private readonly repository: ElementMetadataRepository) {}

  /** Create or replace a single metadata record (validated). */
  async set(record: ElementMetadata): Promise<void> {
    await this.repository.upsert(elementMetadataSchema.parse(record));
  }

  /** Create or replace many records for a version in one call (each validated). */
  async setMany(records: readonly ElementMetadata[]): Promise<void> {
    await this.repository.upsertMany(
      records.map((record) => elementMetadataSchema.parse(record)),
    );
  }

  /** Read one record by composite key, or null if absent. */
  async get(
    diagramVersionId: string,
    elementId: string,
  ): Promise<ElementMetadata | null> {
    return this.repository.find(diagramVersionId, elementId);
  }

  /** All metadata records for a version. */
  async list(diagramVersionId: string): Promise<ElementMetadata[]> {
    return this.repository.listByVersion(diagramVersionId);
  }

  /** Delete one record by composite key. Idempotent; returns whether one existed. */
  async remove(diagramVersionId: string, elementId: string): Promise<boolean> {
    return this.repository.delete(diagramVersionId, elementId);
  }

  /**
   * Re-attach this version's stored metadata to converted elements by `id`.
   *
   * The elements have already lost their `customData` to
   * `convertToExcalidrawElements`; this reunites them with the metadata the store
   * holds, so the store remains the single source of truth.
   */
  async attachToElements<T extends ElementLike>(
    diagramVersionId: string,
    elements: readonly T[],
  ): Promise<Array<ElementWithMetadata<T>>> {
    const records = await this.repository.listByVersion(diagramVersionId);
    return reattachMetadata(elements, records);
  }
}
