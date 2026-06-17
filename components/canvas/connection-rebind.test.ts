// Tests-first for connect — rebind on move/delete (DEV-1139 / task 10b, FR-3).
//
// Arrow-binding is the highest-blast-radius canvas primitive (CLAUDE.md: tests
// first for arrow-binding 10a/b). DEV-1138 owned bind-ON-CREATE; this task owns
// what happens to a bound connection when an endpoint element MOVES or is
// DELETED:
//
//   - MOVE: a connection's geometry must follow its endpoints (FR-3:
//     "connections bind to elements and follow them when moved"). The pure
//     adapter recomputes the bound arrow skeleton from the elements' NEW
//     placements — identical-but-moved inputs yield the moved arrow.
//   - DELETE: deleting an element must not leave a half-bound (orphan)
//     connection behind. The validator's endpoint-binding rule (DEV-1133) fails
//     any connection with an endpoint that no longer references a real element,
//     so the clean resolution is to CASCADE: drop every connection bound to the
//     deleted element. This keeps the committed scene validator-clean.
//
// As with DEV-1138, the Excalidraw RUNTIME is intentionally NOT imported (it
// pulls browser-only deps that don't resolve under Vitest). These exercise the
// pure skeleton/geometry contract + a golden SVG compare (🟡). The LIVE
// drag-follow + cascade-on-delete behavior on a real mount belongs to Playwright
// once the editor exposes connection-drawing UI (a later task); the canvas
// component is owned by DEV-1137 and is intentionally not touched here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildBoundConnection } from "./connection-binding";
import {
  rebindOnMove,
  rebindOnDelete,
  type DeleteResolution,
} from "./connection-rebind";
import { connectionSceneToSvg } from "./connection-to-svg";
import {
  MOVED_CONNECTION_SCENE,
  MOVED_CONNECTION_VIEWPORT,
  REBIND_BASE_SCENE,
} from "./moved-connection.fixture";

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

describe("rebindOnMove (FR-3 — connections follow elements when moved)", () => {
  it("recomputes the arrow anchor + delta from the moved endpoint placement", () => {
    // Move the target tank: dx=+60, dy=+40 from its base placement.
    const moved = rebindOnMove(REBIND_BASE_SCENE, {
      elementId: REBIND_BASE_SCENE.target.element.elementId,
      x: REBIND_BASE_SCENE.target.element.x + 60,
      y: REBIND_BASE_SCENE.target.element.y + 40,
    });

    const before = buildBoundConnection(REBIND_BASE_SCENE) as unknown as {
      x: number;
      y: number;
      points: [number, number][];
    };
    const after = buildBoundConnection(moved) as unknown as {
      x: number;
      y: number;
      points: [number, number][];
    };

    // Source unmoved → arrow anchor (source port) is unchanged.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    // Target moved by (+60,+40) → the endpoint delta grows by exactly that.
    expect(after.points[1][0]).toBe(before.points[1][0] + 60);
    expect(after.points[1][1]).toBe(before.points[1][1] + 40);
  });

  it("moves the anchor when the SOURCE endpoint is the one that moved", () => {
    const moved = rebindOnMove(REBIND_BASE_SCENE, {
      elementId: REBIND_BASE_SCENE.source.element.elementId,
      x: REBIND_BASE_SCENE.source.element.x + 25,
      y: REBIND_BASE_SCENE.source.element.y - 15,
    });
    const before = buildBoundConnection(REBIND_BASE_SCENE) as unknown as {
      x: number;
      y: number;
    };
    const after = buildBoundConnection(moved) as unknown as {
      x: number;
      y: number;
    };
    // Source port (the anchor) shifts by exactly the move delta.
    expect(after.x).toBe(before.x + 25);
    expect(after.y).toBe(before.y - 15);
  });

  it("keeps both endpoint bindings intact across a move (still bound by id)", () => {
    const moved = rebindOnMove(REBIND_BASE_SCENE, {
      elementId: REBIND_BASE_SCENE.target.element.elementId,
      x: 999,
      y: 999,
    });
    const arrow = buildBoundConnection(moved) as unknown as {
      start: { id: string };
      end: { id: string };
    };
    expect(arrow.start.id).toBe(REBIND_BASE_SCENE.source.element.elementId);
    expect(arrow.end.id).toBe(REBIND_BASE_SCENE.target.element.elementId);
  });

  it("preserves size and symbol of the moved element (only x/y change)", () => {
    const moved = rebindOnMove(REBIND_BASE_SCENE, {
      elementId: REBIND_BASE_SCENE.target.element.elementId,
      x: 300,
      y: 200,
    });
    expect(moved.target.element.symbolId).toBe(
      REBIND_BASE_SCENE.target.element.symbolId,
    );
    expect(moved.target.element.size).toBe(
      REBIND_BASE_SCENE.target.element.size,
    );
    expect(moved.target.element.x).toBe(300);
    expect(moved.target.element.y).toBe(200);
  });

  it("is a no-op for a move of an element this connection is not bound to", () => {
    const moved = rebindOnMove(REBIND_BASE_SCENE, {
      elementId: "el-unrelated",
      x: 10,
      y: 10,
    });
    expect(moved).toEqual(REBIND_BASE_SCENE);
  });

  it("does not mutate the input request (pure, returns a new request)", () => {
    const targetXBefore = REBIND_BASE_SCENE.target.element.x;
    rebindOnMove(REBIND_BASE_SCENE, {
      elementId: REBIND_BASE_SCENE.target.element.elementId,
      x: 12345,
      y: 67890,
    });
    expect(REBIND_BASE_SCENE.target.element.x).toBe(targetXBefore);
  });
});

describe("rebindOnDelete (cascade per validator endpoint-binding rule)", () => {
  const CONN_A = {
    elementId: "conn-a",
    sourceElementId: "el-a",
    targetElementId: "el-b",
  };
  const CONN_B = {
    elementId: "conn-b",
    sourceElementId: "el-b",
    targetElementId: "el-c",
  };
  const CONN_C = {
    elementId: "conn-c",
    sourceElementId: "el-x",
    targetElementId: "el-y",
  };
  const ALL = [CONN_A, CONN_B, CONN_C] as const;

  it("removes every connection bound to the deleted element (cascade)", () => {
    const res: DeleteResolution = rebindOnDelete(ALL, "el-b");
    // el-b is an endpoint of both conn-a and conn-b → both cascade out.
    expect(res.removedConnectionIds).toEqual(["conn-a", "conn-b"]);
    expect(res.keptConnections.map((c) => c.elementId)).toEqual(["conn-c"]);
  });

  it("removes a connection bound to the deleted element as SOURCE", () => {
    const res = rebindOnDelete(ALL, "el-x");
    expect(res.removedConnectionIds).toEqual(["conn-c"]);
  });

  it("removes a connection bound to the deleted element as TARGET", () => {
    const res = rebindOnDelete(ALL, "el-c");
    expect(res.removedConnectionIds).toEqual(["conn-b"]);
  });

  it("leaves connections untouched when the deleted element binds none", () => {
    const res = rebindOnDelete(ALL, "el-nobody");
    expect(res.removedConnectionIds).toEqual([]);
    expect(res.keptConnections).toEqual(ALL);
  });

  it("never leaves a half-bound (orphan) connection behind", () => {
    // The whole point of the cascade: no kept connection may still reference the
    // deleted element on either end (that would be an orphan the validator
    // rejects). Assert the invariant directly.
    const res = rebindOnDelete(ALL, "el-b");
    for (const conn of res.keptConnections) {
      expect(conn.sourceElementId).not.toBe("el-b");
      expect(conn.targetElementId).not.toBe("el-b");
    }
  });

  it("does not mutate the input connection list", () => {
    const copy = [...ALL];
    rebindOnDelete(ALL, "el-b");
    expect(ALL).toEqual(copy);
  });
});

describe("moved-connection scene — golden SVG (🟡 visual diff)", () => {
  it("renders the connection following its moved endpoint, matching golden", () => {
    const rendered = connectionSceneToSvg(
      MOVED_CONNECTION_SCENE,
      MOVED_CONNECTION_VIEWPORT,
    );
    const golden = readFileSync(
      join(goldenDir, "moved-connection-scene.svg"),
      "utf8",
    );
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });
});
