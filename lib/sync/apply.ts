/**
 * Browser-side apply reducer for whole-scene broadcasts (DEV-1151 [12a], PRD §4).
 *
 * The receiving half of server-authoritative sync. When a session receives a
 * {@link SceneBroadcast}, it does NOT merge or diff — the server is the single
 * source of truth, so the browser *replaces* its local scene with the broadcast
 * scene and re-renders (the canvas calls `updateScene` with the result). This
 * pure reducer computes that next state; the React/Excalidraw wiring lives in the
 * `"use client"` hook (use-diagram-sync.ts) so the convergence logic stays pure
 * and golden-testable without a DOM.
 *
 * Why a reducer instead of "always replace":
 *   - **Idempotency.** Re-delivering the version a session already holds is a
 *     no-op (`applied: false`), so a reconnect-replay or a duplicate frame never
 *     forces a needless re-render.
 *   - **Wrong-channel safety.** A broadcast for another diagram is rejected, so a
 *     mis-routed frame can never overwrite the scene a session is looking at.
 *
 * Convergence (the acceptance criterion "two sessions on the same diagram
 * converge"): both sessions subscribe to the same diagram and the server emits
 * the same ordered sequence of whole-scene broadcasts to each. Applying that
 * sequence is a left-fold that, for any two sessions, ends on the same final
 * `(versionId, scene)` regardless of each session's prior local edits — because
 * each broadcast wholly replaces, it does not accumulate divergence. The proof
 * obligation reduces to: same final broadcast ⇒ same applied scene. This reducer
 * is that "apply the final broadcast" step.
 */
import { EMPTY_SYNC_STATE, type SceneBroadcast, type SyncState } from "./types";

/** Outcome of applying a broadcast to a session's local sync state. */
export interface ApplyResult {
  /** The session's state after this broadcast (unchanged if not applied). */
  readonly state: SyncState;
  /**
   * Whether the broadcast changed the applied scene. `false` for a duplicate
   * version or a broadcast addressed to a different diagram — the caller should
   * NOT re-render in those cases.
   */
  readonly applied: boolean;
}

/**
 * Apply a whole-scene broadcast to a session that is viewing `diagramId`.
 *
 * Pure: same `(diagramId, prior, broadcast)` always yields the same result; no
 * I/O, no DOM, no mutation of `prior`.
 *
 * @param diagramId  the diagram this session is subscribed to / viewing.
 * @param prior      the session's current applied state ({@link EMPTY_SYNC_STATE}
 *                   if it has applied nothing yet).
 * @param broadcast  the received broadcast.
 * @returns the next state and whether it changed (drives whether the canvas
 *   re-renders). Off-channel or duplicate-version broadcasts are no-ops.
 */
export function applyBroadcast(
  diagramId: string,
  prior: SyncState,
  broadcast: SceneBroadcast,
): ApplyResult {
  // Wrong-channel safety: never let a broadcast for another diagram overwrite
  // the scene this session is viewing.
  if (broadcast.diagramId !== diagramId) {
    return { state: prior, applied: false };
  }
  // Idempotency: re-delivering the already-applied version is a no-op.
  if (prior.versionId === broadcast.versionId) {
    return { state: prior, applied: false };
  }
  return {
    state: { versionId: broadcast.versionId, scene: broadcast.scene },
    applied: true,
  };
}

/**
 * Fold a sequence of broadcasts onto a starting state — the convergence model.
 * Two sessions that receive the same ordered broadcast sequence (from the same
 * starting state) end identical. Used by the convergence test and by a session
 * catching up on a backlog after reconnect.
 */
export function applyBroadcasts(
  diagramId: string,
  start: SyncState,
  broadcasts: readonly SceneBroadcast[],
): SyncState {
  return broadcasts.reduce(
    (state, broadcast) => applyBroadcast(diagramId, state, broadcast).state,
    start,
  );
}

export { EMPTY_SYNC_STATE };
