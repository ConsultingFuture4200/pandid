/**
 * Diagram + DiagramVersion.
 *
 * PRD §7:
 *  - Diagram (id, account_id, name, active flag per account)
 *  - DiagramVersion (id, diagram_id, excalidraw_scene JSON, created_at, immutable)
 *
 * Architecture invariant (CLAUDE.md): versions are immutable. Each save = a new
 * `DiagramVersion` row; a prior version is never mutated. The server (Postgres)
 * is the single source of truth — `excalidrawScene` is the canonical scene, and
 * this layer treats it as opaque JSON so DEV-1130 stays decoupled from
 * Excalidraw's element shape.
 */
import { z } from "zod";
import { isoTimestampSchema, jsonObjectSchema, uuidSchema } from "./common";

export const diagramSchema = z.object({
  id: uuidSchema,
  accountId: uuidSchema,
  name: z.string().min(1),
  /** At most one active diagram per account (the one Claude is scoped to). */
  active: z.boolean(),
});

export type Diagram = z.infer<typeof diagramSchema>;

export const diagramVersionSchema = z.object({
  id: uuidSchema,
  diagramId: uuidSchema,
  /**
   * Canonical Excalidraw scene for this version. Opaque JSON at this layer.
   * Equipment metadata lives in `ElementMetadata`, NOT in scene `customData`
   * (`convertToExcalidrawElements` drops `customData` — see CLAUDE.md).
   */
  excalidrawScene: jsonObjectSchema,
  createdAt: isoTimestampSchema,
});

export type DiagramVersion = z.infer<typeof diagramVersionSchema>;
