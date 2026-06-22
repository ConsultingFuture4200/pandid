/**
 * Propose-op schemas + the discriminated {@link ProposeOp} (DEV-1150).
 *
 * A propose tool describes an INCREMENTAL change (a delta). This leaf module owns
 * the op's argument schemas and the op union itself, so:
 *
 *   - `scene-edit.ts` (the pure transform) imports the op TYPE,
 *   - `propose-tools.ts` (the tool surface) imports the arg SCHEMAS to parse tool
 *     input, and
 *   - the effective-state / accept-materialize path can re-parse a stored op
 *     (opaque `JsonObject`, the proposal layer's source of truth) back into a
 *     typed `ProposeOp`.
 *
 * Keeping these here (importing only zod/types) avoids a value import cycle between
 * `scene-edit` and `propose-tools` (each of which depends on the other).
 */
import { z } from "zod";
import type { JsonObject } from "@/lib/types";

/** Tool/op attribute bag (tag + type-specific fields), JSON-safe. */
const attributesSchema = z
  .record(z.string(), z.unknown())
  .transform((v) => v as JsonObject);

export const addEquipmentArgsSchema = z.object({
  equipmentType: z.string().min(1),
  x: z.number(),
  y: z.number(),
  size: z.number().positive().optional(),
  /** Element attributes (tag + required type-specific fields). */
  attributes: attributesSchema.optional(),
  /**
   * The element id to assign. Populated by the tool at STAGE time so the op is a
   * DETERMINISTIC delta: re-applying it (effective-state rebuild, accept) yields
   * the SAME id every time — which is what lets a later `connect` reference this
   * element by id across pending proposals and across an accept. Tools always set
   * it; absent only on a hand-built op (then `applyOp` mints one).
   */
  elementId: z.string().min(1).optional(),
});
export type AddEquipmentArgs = z.infer<typeof addEquipmentArgsSchema>;

export const connectArgsSchema = z.object({
  sourceElementId: z.string().min(1),
  sourcePort: z.string().min(1),
  targetElementId: z.string().min(1),
  targetPort: z.string().min(1),
  /** Dashed signal line vs solid process line. Defaults to process. */
  signal: z.boolean().optional(),
  /** Optional line id for the connector's metadata. */
  lineId: z.string().min(1).optional(),
  /**
   * The connector element id to assign. Populated by the tool at STAGE time so the
   * op is a deterministic delta (see {@link AddEquipmentArgs.elementId}). Absent
   * only on a hand-built op (then `applyOp` mints one).
   */
  elementId: z.string().min(1).optional(),
  /**
   * Connector attributes (e.g. a process line's required `service`). Merged with
   * `lineId`. A process line that omits a required attribute is REFUSED at
   * staging (FR-8), so set them here.
   */
  attributes: attributesSchema.optional(),
});
export type ConnectArgs = z.infer<typeof connectArgsSchema>;

export const setMetadataArgsSchema = z.object({
  elementId: z.string().min(1),
  attributes: attributesSchema,
});
export type SetMetadataArgs = z.infer<typeof setMetadataArgsSchema>;

export const deleteElementArgsSchema = z.object({
  elementId: z.string().min(1),
});
export type DeleteElementArgs = z.infer<typeof deleteElementArgsSchema>;

export const moveOrRelabelArgsSchema = z
  .object({
    elementId: z.string().min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    tag: z.string().min(1).optional(),
  })
  .refine(
    (v) => v.x !== undefined || v.y !== undefined || v.tag !== undefined,
    "Provide at least one of `x`/`y` (to move) or `tag` (to relabel).",
  );
export type MoveOrRelabelArgs = z.infer<typeof moveOrRelabelArgsSchema>;

/** The discriminated op a propose tool applies. */
export type ProposeOp =
  | { readonly kind: "add-equipment"; readonly args: AddEquipmentArgs }
  | { readonly kind: "connect"; readonly args: ConnectArgs }
  | { readonly kind: "set-metadata"; readonly args: SetMetadataArgs }
  | { readonly kind: "delete-element"; readonly args: DeleteElementArgs }
  | { readonly kind: "move-or-relabel"; readonly args: MoveOrRelabelArgs };

/**
 * Schema for a {@link ProposeOp} as persisted in a proposal's `staged_change.op`
 * (an opaque `JsonObject` at the proposal layer). Used by the accept-materialize
 * and effective-state paths to re-parse a stored op back into a typed op.
 */
export const proposeOpSchema: z.ZodType<ProposeOp> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add-equipment"), args: addEquipmentArgsSchema }),
  z.object({ kind: z.literal("connect"), args: connectArgsSchema }),
  z.object({ kind: z.literal("set-metadata"), args: setMetadataArgsSchema }),
  z.object({ kind: z.literal("delete-element"), args: deleteElementArgsSchema }),
  z.object({ kind: z.literal("move-or-relabel"), args: moveOrRelabelArgsSchema }),
]);

/** Serialize a {@link ProposeOp} to the JSON object stored on a proposal. The op
 * is JSON-safe by construction (Zod-parsed args), so this is a coercion, not I/O. */
export function opToJson(op: ProposeOp): JsonObject {
  return op as unknown as JsonObject;
}

/** Re-parse a stored op (opaque JSON) back into a typed {@link ProposeOp}, or
 * null if the JSON is not a well-formed op (a legacy/hand-edited row). */
export function parseProposeOp(value: unknown): ProposeOp | null {
  const parsed = proposeOpSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
