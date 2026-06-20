/**
 * Public surface of the sync edit-guard module (DEV-1152, PRD §4).
 *
 * Consumers:
 *   - WebSocket client (DEV-1151) → receiveBroadcast on each incoming scene.
 *   - canvas / proposal UI (DEV-1153) → begin/applyLocalEdit/endManipulation
 *     wired to Excalidraw's pointer + label-edit lifecycle.
 *
 * The guard never commits and never touches canonical server state; it only
 * orders how authoritative broadcasts reach the local canvas so an in-flight
 * manual edit is not stomped (CLAUDE.md: server is the single source of truth,
 * one committer).
 */
export { InProgressEditGuard } from "./edit-guard";
export {
  syncElementSchema,
  syncSceneSchema,
} from "./types";
export type {
  SyncElement,
  SyncOutcome,
  SyncOutcomeKind,
  SyncScene,
} from "./types";
export { syncSceneToSvg } from "./scene-to-svg";
