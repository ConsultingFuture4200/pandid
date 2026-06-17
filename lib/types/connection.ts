/**
 * Connection — a logical edge between two equipment elements.
 *
 * PRD §7: "Connection is represented within the Excalidraw scene; line-list
 * export derives from scene + metadata." So a Connection is NOT a persisted
 * row — it is the derived edge a consumer (validator connectivity rules
 * DEV-1133, line-list export DEV-1156) reconstructs from a bound arrow in the
 * scene plus its endpoint metadata.
 *
 * This type is the shared shape of that derived edge: the binding arrow's
 * element id and the two endpoint element ids it connects. Endpoints are
 * nullable to represent an in-progress / orphaned arrow (one end unbound) —
 * detecting orphans is the validator's job, not this layer's.
 */
import { z } from "zod";

export const connectionSchema = z.object({
  /** Excalidraw element id of the arrow/line representing this connection. */
  elementId: z.string().min(1),
  /** Element id of the source endpoint, or null if unbound (orphan). */
  sourceElementId: z.string().min(1).nullable(),
  /** Element id of the target endpoint, or null if unbound (orphan). */
  targetElementId: z.string().min(1).nullable(),
});

export type Connection = z.infer<typeof connectionSchema>;
