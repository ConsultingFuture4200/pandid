/**
 * Commit → broadcast bridge (DEV-1151 [12a], PRD §4).
 *
 * The single seam that turns "a change was committed" into "every session on
 * this diagram is told the new canonical scene". A committed change is a
 * {@link VersionSnapshot} — the immutable version row (id, diagramId, scene)
 * plus its metadata — produced by the one commit pipeline (DEV-1140), whether
 * the change originated from a manual edit or an accepted proposal (DEV-1144).
 * Both call this exact function, so both broadcast: there is no second path.
 *
 * Building the broadcast from the *persisted* version (not from the inbound
 * edit) is deliberate — the server is the single source of truth, so what gets
 * broadcast is exactly what was written, addressed to subscribers by the
 * version's own diagram id. The scene is carried opaquely (it is the canonical
 * Excalidraw scene that was saved).
 */
import { getBroadcastHub, type BroadcastHub } from "./broadcast-hub";
import type { SceneBroadcast } from "./types";

/** The committed-version shape this bridge needs (a {@link VersionSnapshot}). */
export interface CommittedVersion {
  readonly version: {
    readonly id: string;
    readonly diagramId: string;
    readonly excalidrawScene: import("@/lib/types").JsonObject;
  };
}

/** Build the whole-scene broadcast frame for a committed version. */
export function broadcastForCommit(committed: CommittedVersion): SceneBroadcast {
  return {
    type: "scene",
    diagramId: committed.version.diagramId,
    versionId: committed.version.id,
    scene: committed.version.excalidrawScene,
  };
}

/**
 * Publish a committed version's canonical scene to its diagram's subscribers.
 * Call this immediately after a commit lands. Returns the number of live
 * sessions the scene reached (0 is normal — nobody may be viewing the diagram).
 *
 * @param hub  the broadcast hub (defaults to the process-wide instance).
 */
export function publishCommit(
  committed: CommittedVersion,
  hub: BroadcastHub = getBroadcastHub(),
): number {
  return hub.publish(broadcastForCommit(committed));
}
