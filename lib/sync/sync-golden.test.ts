// End-to-end broadcast→apply golden (DEV-1151 [12a] 🟡, PRD §4).
//
// Acceptance (Linear DEV-1151):
//   - Server broadcasts canonical scene on commit
//   - Browser applies broadcast, reflects change
//   - Two browser sessions on same diagram converge
//   - pnpm test + golden scene
//
// This test drives the WHOLE loop with the real hub + the pure apply reducer,
// then renders each session's applied scene and golden-compares it. The golden
// (test/golden/synced-scene.svg) pins "what a session shows after applying the
// broadcast" to the known canonical diagram. The two-session render equality is
// the convergence proof; the golden compare is the 🟡 visual diff.
//
// Normalization matches the established Phase-1/DEV-1142 pattern: collapse
// whitespace and round floats so the golden survives trivial formatting churn
// while still catching any geometry/structure change.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { appliedSceneToSvg } from "./applied-scene-to-svg";
import { applyBroadcast } from "./apply";
import { BroadcastHub } from "./broadcast-hub";
import { publishCommit } from "./publish-commit";
import { EMPTY_SYNC_STATE, type SceneBroadcast, type SyncState } from "./types";
import {
  FIXTURE_DIAGRAM_ID,
  FIXTURE_VERSION_ID,
  SYNC_SCENE,
} from "./sync.fixture";

const goldenDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "test",
  "golden",
);

function normalizeSvg(svg: string): string {
  return svg
    .replace(/\s+/g, " ")
    .replace(/-?\d+\.\d+/g, (m) => String(Math.round(Number(m))))
    .trim();
}

/** A simulated browser session: holds sync state, applies frames it receives. */
function makeSession(diagramId: string): {
  sink: (b: SceneBroadcast) => void;
  state: () => SyncState;
} {
  let state: SyncState = EMPTY_SYNC_STATE;
  return {
    sink: (broadcast) => {
      state = applyBroadcast(diagramId, state, broadcast).state;
    },
    state: () => state,
  };
}

describe("broadcast → apply → render (🟡 golden + convergence)", () => {
  it("a committed scene reaches both sessions, which converge on the same render", () => {
    const hub = new BroadcastHub();
    const sessionA = makeSession(FIXTURE_DIAGRAM_ID);
    const sessionB = makeSession(FIXTURE_DIAGRAM_ID);
    hub.subscribe(FIXTURE_DIAGRAM_ID, sessionA.sink);
    hub.subscribe(FIXTURE_DIAGRAM_ID, sessionB.sink);

    // The server commits and publishes the canonical scene.
    const delivered = publishCommit(
      {
        version: {
          id: FIXTURE_VERSION_ID,
          diagramId: FIXTURE_DIAGRAM_ID,
          excalidrawScene: SYNC_SCENE,
        },
      },
      hub,
    );
    expect(delivered).toBe(2);

    // Both sessions applied the same canonical version.
    expect(sessionA.state().versionId).toBe(FIXTURE_VERSION_ID);
    expect(sessionB.state().versionId).toBe(FIXTURE_VERSION_ID);

    const sceneA = sessionA.state().scene;
    const sceneB = sessionB.state().scene;
    expect(sceneA).not.toBeNull();
    expect(sceneB).not.toBeNull();

    // Convergence: both sessions render byte-identically.
    const svgA = appliedSceneToSvg(sceneA!);
    const svgB = appliedSceneToSvg(sceneB!);
    expect(svgA).toBe(svgB);
  });

  it("the applied scene renders matching the golden fixture", () => {
    const session = makeSession(FIXTURE_DIAGRAM_ID);
    session.sink({
      type: "scene",
      diagramId: FIXTURE_DIAGRAM_ID,
      versionId: FIXTURE_VERSION_ID,
      scene: SYNC_SCENE,
    });
    const rendered = appliedSceneToSvg(session.state().scene!);
    const golden = readFileSync(join(goldenDir, "synced-scene.svg"), "utf8");
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });
});
