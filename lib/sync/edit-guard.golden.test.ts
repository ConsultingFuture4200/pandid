// 🟡 golden visual-diff for the in-progress-edit guard (DEV-1152, PRD §4).
//
// Acceptance (Linear DEV-1152) — the snapshot half:
//   "🟡 LOOP+SNAP: rendered output matches golden within tolerance."
//
// The guard's observable output is the scene the canvas shows. This test drives
// the full concurrent-edit lifecycle (begin → local drag → broadcast mid-drag →
// release) and golden-compares two rendered scenes:
//   1. mid-drag: the in-progress edit is preserved (broadcast deferred).
//   2. post-release: the deferred authoritative broadcast has reconciled.
// Following the established Phase-1 pattern: normalize then byte-compare to a
// committed fixture under test/golden.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { InProgressEditGuard } from "./edit-guard";
import { syncSceneToSvg } from "./scene-to-svg";
import {
  GUARD_BASE_SCENE,
  GUARD_BROADCAST_SCENE,
  GUARD_IN_PROGRESS_SCENE,
  GUARD_VIEWPORT,
} from "./edit-guard.fixture";

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

function readGolden(name: string): string {
  return readFileSync(join(goldenDir, name), "utf8");
}

describe("InProgressEditGuard — golden compare (🟡 visual diff)", () => {
  it("preserves the in-progress drag while a broadcast is deferred", () => {
    const guard = new InProgressEditGuard(GUARD_BASE_SCENE);
    guard.beginManipulation();
    guard.applyLocalEdit(GUARD_IN_PROGRESS_SCENE);
    const outcome = guard.receiveBroadcast(GUARD_BROADCAST_SCENE);
    expect(outcome.kind).toBe("deferred");

    const rendered = syncSceneToSvg(guard.currentScene(), GUARD_VIEWPORT);
    expect(normalizeSvg(rendered)).toBe(
      normalizeSvg(readGolden("sync-in-progress-drag.svg")),
    );
  });

  it("reconciles to the authoritative broadcast on release", () => {
    const guard = new InProgressEditGuard(GUARD_BASE_SCENE);
    guard.beginManipulation();
    guard.applyLocalEdit(GUARD_IN_PROGRESS_SCENE);
    guard.receiveBroadcast(GUARD_BROADCAST_SCENE);
    const reconciled = guard.endManipulation();
    expect(reconciled.scene).toEqual(GUARD_BROADCAST_SCENE);

    const rendered = syncSceneToSvg(guard.currentScene(), GUARD_VIEWPORT);
    expect(normalizeSvg(rendered)).toBe(
      normalizeSvg(readGolden("sync-reconciled.svg")),
    );
  });
});
