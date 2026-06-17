/**
 * Persistence-layer types for diagram CRUD + immutable versioning
 * (DEV-1135, FR-17–19, SC-6).
 *
 * The domain entities (`Diagram`, `DiagramVersion`, `ElementMetadata`) live in
 * `@/lib/types` (DEV-1130); this module models only the inputs/outputs the
 * persistence surface needs and a typed error for its boundary failures.
 *
 * SC-6 ("version restore returns an exact prior scene + metadata") couples a
 * version's scene JSON with its element metadata. A saved/loaded version is
 * therefore carried as a single `VersionSnapshot` so the two never drift apart.
 */
import { z } from "zod";
import {
  diagramVersionSchema,
  elementMetadataSchema,
  jsonObjectSchema,
  type Diagram,
  type DiagramVersion,
  type ElementMetadata,
} from "@/lib/types";

/**
 * A version's canonical scene plus the element metadata captured with it.
 * This is the unit SC-6 restores byte-for-byte: scene + metadata intact.
 */
export const versionSnapshotSchema = z.object({
  version: diagramVersionSchema,
  /** Element metadata rows belonging to this version (keyed by element id). */
  metadata: z.array(elementMetadataSchema),
});
export type VersionSnapshot = z.infer<typeof versionSnapshotSchema>;

/** Metadata to persist with a new version, before its version id is known. */
export const versionMetadataInputSchema = elementMetadataSchema.omit({
  diagramVersionId: true,
});
export type VersionMetadataInput = z.infer<typeof versionMetadataInputSchema>;

/** Input for saving a new immutable version of a diagram. */
export const saveVersionInputSchema = z.object({
  /** Canonical Excalidraw scene for the new version. Opaque JSON here. */
  excalidrawScene: jsonObjectSchema,
  /** Element metadata captured with this version (may be empty). */
  metadata: z.array(versionMetadataInputSchema),
});
export type SaveVersionInput = z.infer<typeof saveVersionInputSchema>;

/** A diagram together with its full immutable version history (newest first). */
export interface DiagramWithVersions {
  readonly diagram: Diagram;
  readonly versions: readonly DiagramVersion[];
}

export type { Diagram, DiagramVersion, ElementMetadata };

/** Typed failure modes at the persistence boundary. */
export type DiagramErrorCode = "not_found" | "invalid_input" | "forbidden";

/**
 * Boundary error for the persistence layer. Messages say what happened + how to
 * fix (CLAUDE.md), produced from the discriminant at the call site.
 */
export class DiagramError extends Error {
  readonly code: DiagramErrorCode;
  constructor(code: DiagramErrorCode, message: string) {
    super(message);
    this.name = "DiagramError";
    this.code = code;
  }
}
