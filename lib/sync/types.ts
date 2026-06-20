/**
 * WebSocket sync types (DEV-1151 [12a], PRD §4).
 *
 * Realtime sync is **server-authoritative whole-scene broadcast** (CLAUDE.md
 * stack: "Server-authoritative; whole-scene broadcast"). The server is the
 * single source of truth: on any committed change — a manual edit (DEV-1140) or
 * an accepted proposal (DEV-1144) — the server broadcasts the new canonical
 * scene to every session subscribed to that diagram. Each browser then *applies*
 * the broadcast: it replaces its local scene with the canonical one and
 * re-renders. There is no client-authoritative delta path; clients never tell
 * each other what changed, they are told the whole truth.
 *
 * This module is the transport-agnostic core of that loop:
 *   - {@link SceneBroadcast}  — the message the server emits on commit.
 *   - the broadcast hub (broadcast-hub.ts) — server-side per-diagram fan-out.
 *   - the apply function (apply.ts) — the pure browser-side reducer that turns a
 *     received broadcast into the scene the canvas should render.
 *
 * Keeping the message + apply logic free of any WebSocket/DOM dependency makes
 * the convergence guarantee (two sessions on one diagram end up identical)
 * deterministic and golden-testable in CI (🟡) without a live socket or browser.
 *
 * The in-progress-edit guard (don't clobber a session mid-edit) is DEV-1152 and
 * deliberately lives behind this module — broadcast + apply must stand alone.
 */
import { z } from "zod";
import { jsonObjectSchema, uuidSchema, type JsonObject } from "@/lib/types";

/**
 * A whole-scene broadcast: the canonical Excalidraw scene of a diagram at a
 * committed version, addressed to everyone subscribed to that diagram.
 *
 * `versionId` is the immutable {@link import("@/lib/types").DiagramVersion} id
 * the scene belongs to. Each commit appends a new version, so a fresh
 * `versionId` means "newer canonical truth". A receiver uses it to ignore a
 * broadcast it has already applied (same version) — the basis of idempotent
 * convergence in {@link import("./apply").applyBroadcast}. Per-connection
 * WebSocket ordering plus a server-authoritative source means broadcasts arrive
 * in commit order, so identity-dedup is sufficient; no client-side reordering.
 */
export const sceneBroadcastSchema = z.object({
  /** Message discriminant — every sync frame carries an explicit `type`. */
  type: z.literal("scene"),
  /** The diagram this scene belongs to (the broadcast channel key). */
  diagramId: uuidSchema,
  /** The committed version id whose scene this is. Monotonic per diagram. */
  versionId: uuidSchema,
  /** Canonical Excalidraw scene to render. Opaque JSON at this layer. */
  scene: jsonObjectSchema,
});
export type SceneBroadcast = z.infer<typeof sceneBroadcastSchema>;

/**
 * A session's local view of a diagram: the last scene it has applied and the
 * version that scene came from. A fresh session that has applied nothing yet
 * carries a `null` version (it will accept the first broadcast it sees).
 */
export interface SyncState {
  /** Version id of the currently-applied scene, or null if none applied yet. */
  readonly versionId: string | null;
  /** The currently-applied canonical scene, or null if none applied yet. */
  readonly scene: JsonObject | null;
}

/** An empty (nothing-applied-yet) sync state. */
export const EMPTY_SYNC_STATE: SyncState = { versionId: null, scene: null };
