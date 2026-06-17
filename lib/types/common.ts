/**
 * Shared primitives for the domain model.
 *
 * Types-only module (DEV-1130). No persistence, no logic — just the contract
 * every other module depends on. Zod schemas are the boundary validators
 * (Zod-at-all-boundaries, per CLAUDE.md stack constraints); the TypeScript
 * types are derived from them via `z.infer` so the schema is the single
 * source of truth.
 */
import { z } from "zod";

/**
 * Opaque JSON value. Used for payloads that this layer deliberately does not
 * model (e.g. an Excalidraw scene, a staged change, a validator report).
 * DEV-1130 is types-only and must not couple to Excalidraw's element shape.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/** A JSON object payload (top-level object, not a bare scalar/array). */
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
export type JsonObject = z.infer<typeof jsonObjectSchema>;

/** UUID string. Every entity id is a UUID. */
export const uuidSchema = z.string().uuid();

/** ISO-8601 timestamp string. */
export const isoTimestampSchema = z.string().datetime();
