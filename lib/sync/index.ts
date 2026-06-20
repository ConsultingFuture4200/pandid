/**
 * Public surface of the sync module (PRD §4).
 *
 * Two complementary layers (see ./types):
 *   - DEV-1151 [12a] — server-authoritative whole-scene broadcast + apply. A
 *     commit publishes the new canonical scene through {@link getBroadcastHub}
 *     via {@link publishCommit}; the browser reduces a received
 *     {@link SceneBroadcast} onto its {@link SyncState} with {@link applyBroadcast}.
 *   - DEV-1152 [12b] — the in-progress-edit guard ({@link InProgressEditGuard}):
 *     defers an authoritative broadcast that arrives mid-manipulation and
 *     reconciles on release, so an in-flight manual edit is never stomped.
 *
 * Both layers are transport- and DOM-free (CLAUDE.md: server is the single
 * source of truth, one committer); neither commits or mutates canonical state.
 */

// DEV-1151 [12a] — whole-scene broadcast + apply
export { sceneBroadcastSchema, EMPTY_SYNC_STATE } from "./types";
export type { SceneBroadcast, SyncState } from "./types";

export { applyBroadcast, applyBroadcasts } from "./apply";
export type { ApplyResult } from "./apply";

export { BroadcastHub, getBroadcastHub } from "./broadcast-hub";
export type { BroadcastSink, Unsubscribe } from "./broadcast-hub";

export { broadcastForCommit, publishCommit } from "./publish-commit";
export type { CommittedVersion } from "./publish-commit";

export { useDiagramSync } from "./use-diagram-sync";
export type { DiagramSync, UseDiagramSyncOptions } from "./use-diagram-sync";

// DEV-1152 [12b] — in-progress-edit guard
export { InProgressEditGuard } from "./edit-guard";
export { syncElementSchema, syncSceneSchema } from "./types";
export type { SyncElement, SyncOutcome, SyncOutcomeKind, SyncScene } from "./types";
export { syncSceneToSvg } from "./scene-to-svg";
