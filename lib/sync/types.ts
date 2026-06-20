/**
 * Sync module types (PRD §4) — two complementary layers:
 *
 *   - **Whole-scene broadcast + apply (DEV-1151 [12a]).** Server-authoritative
 *     whole-scene broadcast (CLAUDE.md: "Server-authoritative; whole-scene
 *     broadcast"). On any committed change — a manual edit (DEV-1140) or an
 *     accepted proposal (DEV-1144) — the server broadcasts the new canonical
 *     scene to every session on that diagram; each browser *applies* it
 *     (replace + re-render). No client-authoritative delta path. Modeled by
 *     {@link SceneBroadcast} / {@link SyncState} (scene is opaque JSON, keyed by
 *     the immutable `versionId`).
 *
 *   - **In-progress-edit guard (DEV-1152 [12b]).** The one painful failure mode
 *     of whole-scene broadcast: a broadcast arriving mid-manipulation (drag,
 *     label-typing) would stomp the human's in-progress edit. The guard defers
 *     such broadcasts and reconciles on release. Modeled by {@link SyncScene} /
 *     {@link SyncElement} / {@link SyncOutcome} (a minimal structured element
 *     set keyed by a monotonic `rev`).
 *
 * Both layers are deliberately framework-agnostic (no WebSocket/DOM), so the
 * convergence and defer/reconcile guarantees are deterministic and
 * golden-testable in CI (🟡) without a live socket or browser.
 *
 * NOTE (integration seam, intentionally not wired here): the guard models a
 * scene as {@link SyncScene} (`rev` + elements) while the broadcast carries an
 * opaque {@link SceneBroadcast} (`versionId` + JSON scene). The WS client that
 * binds DEV-1151's broadcasts into DEV-1152's guard reconciles those two shapes;
 * that wiring lands with the canvas/WS-client integration, not in this module.
 */
import { z } from "zod";
import { jsonObjectSchema, uuidSchema, type JsonObject } from "@/lib/types";

// ─── DEV-1151 [12a]: whole-scene broadcast + apply ──────────────────────────

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

// ─── DEV-1152 [12b]: in-progress-edit guard ─────────────────────────────────

/**
 * One element in a synced scene. `id` is the stable element id the server and
 * every client agree on; `x`/`y` are scene-space position; `label` is the
 * optional text the human may be typing. The guard only needs identity and the
 * fields a concurrent edit can touch — it never interprets geometry.
 */
export const syncElementSchema = z.object({
  /** Stable element id (server-authoritative, shared across clients). */
  id: z.string().min(1),
  /** Scene-space x of the element. */
  x: z.number(),
  /** Scene-space y of the element. */
  y: z.number(),
  /** Optional element label (e.g. an equipment tag the human is typing). */
  label: z.string().optional(),
});
export type SyncElement = z.infer<typeof syncElementSchema>;

/**
 * A whole-scene snapshot: the unit broadcast by the WebSocket layer and the unit
 * the guard defers/applies. `rev` is a monotonically increasing server revision;
 * the guard uses it to keep only the newest deferred broadcast (older ones are
 * superseded) and to reject stale broadcasts.
 */
export const syncSceneSchema = z.object({
  /** Server revision number; strictly increases per committed change. */
  rev: z.number().int().nonnegative(),
  /** The full element set at this revision. */
  elements: z.array(syncElementSchema),
});
export type SyncScene = z.infer<typeof syncSceneSchema>;

/**
 * What an applied/incoming broadcast did to the guard, returned so the canvas
 * binding knows whether to repaint now or wait for release.
 *
 * - `applied`   — broadcast was applied to the live scene immediately (idle).
 * - `deferred`  — a manipulation is in progress; broadcast was buffered.
 * - `superseded`— the incoming broadcast was stale (rev ≤ what the guard already
 *                 holds), so it was dropped in favor of the newer state.
 */
export type SyncOutcomeKind = "applied" | "deferred" | "superseded";

/** Result of feeding an incoming broadcast to the guard. */
export interface SyncOutcome {
  readonly kind: SyncOutcomeKind;
  /** The scene the canvas should now show, or null if nothing changed. */
  readonly scene: SyncScene | null;
}
