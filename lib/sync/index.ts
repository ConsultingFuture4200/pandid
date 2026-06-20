/**
 * Public surface of the WebSocket sync module (DEV-1151 [12a], PRD §4).
 *
 * Server-authoritative whole-scene broadcast + apply:
 *   - Server side: a commit publishes the new canonical scene through the
 *     process-wide {@link getBroadcastHub} via {@link publishCommit}; the
 *     WebSocket route (DEV-1152 transport) registers per-session sinks with
 *     {@link BroadcastHub.subscribe}.
 *   - Browser side: a received {@link SceneBroadcast} is reduced onto the
 *     session's {@link SyncState} by {@link applyBroadcast} (pure), and the
 *     canvas re-renders only when `applied` is true.
 *
 * The apply/broadcast core is transport- and DOM-free so convergence is
 * deterministic and golden-testable (🟡). The in-progress-edit guard is DEV-1152.
 */
export {
  sceneBroadcastSchema,
  EMPTY_SYNC_STATE,
} from "./types";
export type { SceneBroadcast, SyncState } from "./types";

export { applyBroadcast, applyBroadcasts } from "./apply";
export type { ApplyResult } from "./apply";

export { BroadcastHub, getBroadcastHub } from "./broadcast-hub";
export type { BroadcastSink, Unsubscribe } from "./broadcast-hub";

export { broadcastForCommit, publishCommit } from "./publish-commit";
export type { CommittedVersion } from "./publish-commit";

export { useDiagramSync } from "./use-diagram-sync";
export type { DiagramSync, UseDiagramSyncOptions } from "./use-diagram-sync";
