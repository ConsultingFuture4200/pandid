/**
 * Sync types for the in-progress-edit guard (DEV-1152, PRD §4).
 *
 * Context (CLAUDE.md architecture invariant): the server is the single source of
 * truth for diagram state. The WebSocket layer broadcasts the whole authoritative
 * scene to every client (DEV-1151). The one painful failure mode of whole-scene
 * broadcast is that a broadcast arriving while the human is mid-manipulation
 * (dragging an element, typing a label) would stomp their in-progress edit when
 * applied. This module models the guard that prevents that.
 *
 * These types are deliberately framework-agnostic: a `SyncScene` is the minimal
 * shape the guard needs to defer/apply/reconcile, not an Excalidraw scene. The
 * canvas binds an Excalidraw scene to this shape; the guard logic stays pure and
 * loop-closable (testable + golden-renderable without a browser).
 */
import { z } from "zod";

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
