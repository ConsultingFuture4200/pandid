// Apply-reducer tests (DEV-1151 [12a], PRD §4).
//
// The browser-side half: a received whole-scene broadcast replaces the local
// scene (server is source of truth), idempotently and only for the right diagram.
// Convergence is proved here as a pure fold so it needs no socket or DOM.

import { describe, expect, it } from "vitest";
import type { JsonObject } from "@/lib/types";
import { applyBroadcast, applyBroadcasts } from "./apply";
import { EMPTY_SYNC_STATE, type SceneBroadcast } from "./types";

const DIAGRAM = "11111111-1111-4111-8111-111111111111";
const OTHER_DIAGRAM = "99999999-9999-4999-8999-999999999999";

function broadcast(versionId: string, scene: JsonObject): SceneBroadcast {
  return { type: "scene", diagramId: DIAGRAM, versionId, scene };
}

const V1 = "22222222-2222-4222-8222-222222222222";
const V2 = "33333333-3333-4333-8333-333333333333";

describe("applyBroadcast", () => {
  it("applies a broadcast onto a fresh (empty) session", () => {
    const result = applyBroadcast(
      DIAGRAM,
      EMPTY_SYNC_STATE,
      broadcast(V1, { a: 1 }),
    );
    expect(result.applied).toBe(true);
    expect(result.state.versionId).toBe(V1);
    expect(result.state.scene).toEqual({ a: 1 });
  });

  it("replaces the whole scene (no merge with the prior scene)", () => {
    const prior = applyBroadcast(
      DIAGRAM,
      EMPTY_SYNC_STATE,
      broadcast(V1, { keep: "old", drop: "old" }),
    ).state;
    const next = applyBroadcast(DIAGRAM, prior, broadcast(V2, { keep: "new" }));
    expect(next.applied).toBe(true);
    // Whole-scene replace: the prior `drop` key is gone, not merged.
    expect(next.state.scene).toEqual({ keep: "new" });
    expect(next.state.versionId).toBe(V2);
  });

  it("is idempotent: re-delivering the applied version is a no-op", () => {
    const applied = applyBroadcast(
      DIAGRAM,
      EMPTY_SYNC_STATE,
      broadcast(V1, { a: 1 }),
    ).state;
    const again = applyBroadcast(DIAGRAM, applied, broadcast(V1, { a: 1 }));
    expect(again.applied).toBe(false);
    expect(again.state).toBe(applied);
  });

  it("rejects a broadcast addressed to a different diagram", () => {
    const offChannel: SceneBroadcast = {
      type: "scene",
      diagramId: OTHER_DIAGRAM,
      versionId: V1,
      scene: { a: 1 },
    };
    const result = applyBroadcast(DIAGRAM, EMPTY_SYNC_STATE, offChannel);
    expect(result.applied).toBe(false);
    expect(result.state).toBe(EMPTY_SYNC_STATE);
  });

  it("does not mutate the prior state", () => {
    const prior = EMPTY_SYNC_STATE;
    applyBroadcast(DIAGRAM, prior, broadcast(V1, { a: 1 }));
    expect(prior).toEqual({ versionId: null, scene: null });
  });
});

describe("convergence — two sessions on the same diagram", () => {
  const sequence: readonly SceneBroadcast[] = [
    broadcast(V1, { step: 1 }),
    broadcast(V2, { step: 2 }),
  ];

  it("two sessions receiving the same ordered broadcasts end identical", () => {
    // Session A starts empty.
    const a = applyBroadcasts(DIAGRAM, EMPTY_SYNC_STATE, sequence);
    // Session B starts from a different local edit but receives the same frames.
    const bStart = applyBroadcast(
      DIAGRAM,
      EMPTY_SYNC_STATE,
      broadcast("44444444-4444-4444-8444-444444444444", { local: "draft" }),
    ).state;
    const b = applyBroadcasts(DIAGRAM, bStart, sequence);

    expect(a).toEqual(b);
    expect(a.versionId).toBe(V2);
    expect(a.scene).toEqual({ step: 2 });
  });

  it("a duplicated/replayed frame does not break convergence", () => {
    const withReplay: readonly SceneBroadcast[] = [
      broadcast(V1, { step: 1 }),
      broadcast(V1, { step: 1 }), // duplicate delivery
      broadcast(V2, { step: 2 }),
    ];
    const clean = applyBroadcasts(DIAGRAM, EMPTY_SYNC_STATE, sequence);
    const replayed = applyBroadcasts(DIAGRAM, EMPTY_SYNC_STATE, withReplay);
    expect(replayed).toEqual(clean);
  });
});
