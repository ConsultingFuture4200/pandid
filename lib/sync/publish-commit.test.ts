// Commit→broadcast bridge tests (DEV-1151 [12a], PRD §4).
//
// Both a manual edit and an accepted proposal land as a committed VersionSnapshot
// and broadcast through this one bridge — proving "server broadcasts canonical
// scene on commit" for both change sources.

import { describe, expect, it, vi } from "vitest";
import { BroadcastHub } from "./broadcast-hub";
import { broadcastForCommit, publishCommit } from "./publish-commit";
import type { CommittedVersion } from "./publish-commit";

const DIAGRAM = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";

function committed(scene: Record<string, unknown>): CommittedVersion {
  return {
    version: {
      id: VERSION,
      diagramId: DIAGRAM,
      excalidrawScene: scene as CommittedVersion["version"]["excalidrawScene"],
    },
  };
}

describe("broadcastForCommit", () => {
  it("builds the whole-scene frame from the persisted version", () => {
    const frame = broadcastForCommit(committed({ elements: [] }));
    expect(frame).toEqual({
      type: "scene",
      diagramId: DIAGRAM,
      versionId: VERSION,
      scene: { elements: [] },
    });
  });
});

describe("publishCommit", () => {
  it("delivers the committed scene to the diagram's subscribers", () => {
    const hub = new BroadcastHub();
    const sink = vi.fn();
    hub.subscribe(DIAGRAM, sink);

    const delivered = publishCommit(committed({ elements: [{ id: "x" }] }), hub);

    expect(delivered).toBe(1);
    expect(sink).toHaveBeenCalledWith({
      type: "scene",
      diagramId: DIAGRAM,
      versionId: VERSION,
      scene: { elements: [{ id: "x" }] },
    });
  });

  it("broadcasts a manual-edit commit and an accepted-proposal commit identically", () => {
    // Both sources produce a VersionSnapshot; the bridge cannot tell them apart,
    // which is the point — one committer, one broadcast path.
    const hub = new BroadcastHub();
    const sink = vi.fn();
    hub.subscribe(DIAGRAM, sink);

    const manual = committed({ source: "manual", elements: [] });
    const proposal = committed({ source: "proposal", elements: [] });
    publishCommit(manual, hub);
    publishCommit(proposal, hub);

    expect(sink).toHaveBeenNthCalledWith(1, broadcastForCommit(manual));
    expect(sink).toHaveBeenNthCalledWith(2, broadcastForCommit(proposal));
  });

  it("returns 0 when no session is viewing the committed diagram", () => {
    const hub = new BroadcastHub();
    expect(publishCommit(committed({}), hub)).toBe(0);
  });
});
