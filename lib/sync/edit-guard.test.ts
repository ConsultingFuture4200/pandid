// Tests for the in-progress-edit guard (DEV-1152 🟡, PRD §4).
//
// Acceptance (Linear DEV-1152):
//   - Broadcast during active manipulation is deferred, not applied.
//   - On manipulation end, deferred state reconciles.
//   - Test simulates concurrent broadcast + drag.
//
// Tests-first (CLAUDE.md: sync guard is a high-blast-radius primitive). The guard
// is a pure state machine, so its whole contract is asserted here without a
// browser; the 🟡 golden compare lives in edit-guard.golden.test.ts.

import { describe, expect, it } from "vitest";

import { InProgressEditGuard } from "./edit-guard";
import type { SyncScene } from "./types";

function scene(rev: number, elements: SyncScene["elements"]): SyncScene {
  return { rev, elements };
}

const base = scene(1, [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 100, y: 0 },
]);

describe("InProgressEditGuard — idle behavior", () => {
  it("applies a broadcast immediately when no manipulation is in progress", () => {
    const guard = new InProgressEditGuard(base);
    const next = scene(2, [
      { id: "a", x: 10, y: 10 },
      { id: "b", x: 100, y: 0 },
    ]);
    const outcome = guard.receiveBroadcast(next);
    expect(outcome.kind).toBe("applied");
    expect(outcome.scene).toEqual(next);
    expect(guard.currentScene()).toEqual(next);
    expect(guard.hasDeferred()).toBe(false);
  });

  it("drops a stale broadcast (rev <= current) as superseded", () => {
    const guard = new InProgressEditGuard(scene(5, base.elements));
    const stale = scene(5, [{ id: "a", x: 999, y: 999 }]);
    const outcome = guard.receiveBroadcast(stale);
    expect(outcome.kind).toBe("superseded");
    expect(outcome.scene).toBeNull();
    expect(guard.currentScene().rev).toBe(5);
  });
});

describe("InProgressEditGuard — concurrent broadcast + drag", () => {
  it("defers a broadcast that arrives mid-drag instead of stomping the edit", () => {
    const guard = new InProgressEditGuard(base);

    // Human grabs element "a" and starts dragging it.
    guard.beginManipulation();
    guard.applyLocalEdit(
      scene(1, [
        { id: "a", x: 42, y: 7 }, // in-progress local position
        { id: "b", x: 100, y: 0 },
      ]),
    );

    // A server broadcast lands mid-drag moving "a" elsewhere.
    const broadcast = scene(2, [
      { id: "a", x: 500, y: 500 }, // would stomp the drag
      { id: "b", x: 100, y: 0 },
    ]);
    const outcome = guard.receiveBroadcast(broadcast);

    // Deferred, NOT applied: the human's in-progress edit is preserved.
    expect(outcome.kind).toBe("deferred");
    expect(outcome.scene).toBeNull();
    expect(guard.currentScene().elements.find((e) => e.id === "a")?.x).toBe(42);
    expect(guard.hasDeferred()).toBe(true);
  });

  it("reconciles the deferred broadcast on manipulation end", () => {
    const guard = new InProgressEditGuard(base);
    guard.beginManipulation();
    guard.applyLocalEdit(scene(1, [{ id: "a", x: 42, y: 7 }, { id: "b", x: 100, y: 0 }]));

    const broadcast = scene(2, [
      { id: "a", x: 500, y: 500 },
      { id: "b", x: 100, y: 0 },
    ]);
    guard.receiveBroadcast(broadcast);

    // Release: the authoritative deferred broadcast now wins (server is SoT).
    const reconciled = guard.endManipulation();
    expect(reconciled.kind).toBe("applied");
    expect(reconciled.scene).toEqual(broadcast);
    expect(guard.currentScene()).toEqual(broadcast);
    expect(guard.hasDeferred()).toBe(false);
  });

  it("keeps only the newest of several broadcasts deferred during one manipulation", () => {
    const guard = new InProgressEditGuard(base);
    guard.beginManipulation();

    const first = scene(2, [{ id: "a", x: 1, y: 1 }]);
    const second = scene(3, [{ id: "a", x: 2, y: 2 }]);
    const third = scene(4, [{ id: "a", x: 3, y: 3 }]);

    expect(guard.receiveBroadcast(first).kind).toBe("deferred");
    expect(guard.receiveBroadcast(second).kind).toBe("deferred");
    expect(guard.receiveBroadcast(third).kind).toBe("deferred");

    // Out-of-order / stale broadcast arriving late is superseded, not deferred.
    const late = scene(3, [{ id: "a", x: 99, y: 99 }]);
    expect(guard.receiveBroadcast(late).kind).toBe("superseded");

    const reconciled = guard.endManipulation();
    expect(reconciled.scene).toEqual(third);
    expect(guard.currentScene().rev).toBe(4);
  });

  it("on release with no deferred broadcast, keeps the local scene (nothing to reconcile)", () => {
    const guard = new InProgressEditGuard(base);
    guard.beginManipulation();
    const edited = scene(1, [{ id: "a", x: 42, y: 7 }, { id: "b", x: 100, y: 0 }]);
    guard.applyLocalEdit(edited);
    const reconciled = guard.endManipulation();
    expect(reconciled.kind).toBe("applied");
    expect(reconciled.scene).toBeNull();
    expect(guard.currentScene()).toEqual(edited);
    expect(guard.hasDeferred()).toBe(false);
  });
});

describe("InProgressEditGuard — guards against misuse", () => {
  it("rejects applyLocalEdit when no manipulation is in progress", () => {
    const guard = new InProgressEditGuard(base);
    expect(() => guard.applyLocalEdit(base)).toThrow(/no manipulation in progress/i);
  });

  it("rejects beginManipulation while already manipulating", () => {
    const guard = new InProgressEditGuard(base);
    guard.beginManipulation();
    expect(() => guard.beginManipulation()).toThrow(/already in progress/i);
  });

  it("rejects endManipulation when not manipulating", () => {
    const guard = new InProgressEditGuard(base);
    expect(() => guard.endManipulation()).toThrow(/none is in progress/i);
  });

  it("validates incoming broadcasts at the boundary", () => {
    const guard = new InProgressEditGuard(base);
    expect(() =>
      guard.receiveBroadcast({ rev: -1, elements: [] } as unknown as SyncScene),
    ).toThrow();
  });
});
