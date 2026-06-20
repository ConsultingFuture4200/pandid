// Fixtures for the in-progress-edit guard 🟡 golden compare (DEV-1152).
//
// One concrete concurrent-edit scenario, shared by the golden test so the
// snapshot tracks exactly the guard contract: a broadcast arriving mid-drag is
// deferred (the drag is preserved), and on release the authoritative broadcast
// reconciles. Pure data — no imports beyond the sync types.

import type { SyncScene } from "./types";

/** What the client shows before the human touches anything (rev 1). */
export const GUARD_BASE_SCENE: SyncScene = {
  rev: 1,
  elements: [
    { id: "EX-101", x: 40, y: 40, label: "extraction" },
    { id: "TK-101", x: 200, y: 40, label: "tank" },
    { id: "PMP-1", x: 200, y: 200, label: "pump" },
  ],
};

/** The human's in-progress drag of EX-101 (still rev 1; local only). */
export const GUARD_IN_PROGRESS_SCENE: SyncScene = {
  rev: 1,
  elements: [
    { id: "EX-101", x: 96, y: 128, label: "extraction" },
    { id: "TK-101", x: 200, y: 40, label: "tank" },
    { id: "PMP-1", x: 200, y: 200, label: "pump" },
  ],
};

/**
 * The authoritative broadcast that lands mid-drag (rev 2): Claude's accepted
 * proposal moved TK-101 and relabeled PMP-1. It must NOT stomp the EX-101 drag
 * while busy, and must win on release.
 */
export const GUARD_BROADCAST_SCENE: SyncScene = {
  rev: 2,
  elements: [
    { id: "EX-101", x: 40, y: 40, label: "extraction" },
    { id: "TK-101", x: 320, y: 40, label: "collection-tank" },
    { id: "PMP-1", x: 200, y: 200, label: "feed-pump" },
  ],
};

/** Viewport the golden SVG is rendered into. */
export const GUARD_VIEWPORT = { width: 400, height: 280 } as const;
