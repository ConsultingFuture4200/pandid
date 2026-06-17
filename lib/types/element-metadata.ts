/**
 * ElementMetadata — the parallel, element-id-keyed equipment store.
 *
 * PRD §7: ElementMetadata (diagram_version_id, element_id, equipment_type,
 * attributes JSONB) — the parallel store.
 *
 * Critical implementation fact (CLAUDE.md #1): `convertToExcalidrawElements`
 * drops `customData`, so equipment metadata MUST NOT be persisted on the
 * Excalidraw element. It lives here, keyed by the Excalidraw element `id`
 * (`elementId`) within a specific immutable `diagramVersionId`.
 *
 * Acceptance (DEV-1130): metadata type is keyed by element id, NOT by
 * Excalidraw customData. `elementId` is that key.
 */
import { z } from "zod";
import { jsonObjectSchema, uuidSchema } from "./common";

export const elementMetadataSchema = z.object({
  /** The immutable version this metadata snapshot belongs to. */
  diagramVersionId: uuidSchema,
  /** Excalidraw element id this metadata is keyed to (the join key). */
  elementId: z.string().min(1),
  /**
   * Equipment type tag (e.g. an extraction-equipment symbol kind). The symbol
   * library (DEV-1131) defines the allowed set + required attributes; this layer
   * keeps it an open string so types-only DEV-1130 does not depend on symbols.
   */
  equipmentType: z.string().min(1),
  /** Per-element attributes (tag, rating, etc.). Shape validated by the validator. */
  attributes: jsonObjectSchema,
});

export type ElementMetadata = z.infer<typeof elementMetadataSchema>;
