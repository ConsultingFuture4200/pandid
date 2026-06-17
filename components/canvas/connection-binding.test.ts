// Tests-first for manual connect — bind on create (DEV-1138 / task 10a, FR-3).
//
// Arrow-binding is the highest-blast-radius canvas primitive (CLAUDE.md: tests
// first for arrow-binding 10a/b). These exercise the binding adapter without a
// browser: the produced arrow skeleton carries the exact `start`/`end` `{ id }`
// contract `convertToExcalidrawElements` consumes to set startBinding/endBinding,
// plus a golden compare of the "two equipment + bound connection" scene (🟡).
//
// The Excalidraw RUNTIME (`convertToExcalidrawElements`) is intentionally NOT
// imported here: it pulls in browser-only deps (roughjs) that do not resolve in
// the Vitest node environment — the project's established pattern (see
// canvas.test.ts) keeps unit/golden tests on the pure skeleton contract and
// asserts the live binding + drag-follow behavior in Playwright
// (e2e/canvas.spec.ts), the only place a real Excalidraw mount exists. Moving
// the bound arrow when an endpoint is dragged is task 10b (DEV-1139); this task
// only owns the INITIAL bound-on-create arrow.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildBoundConnection,
  type PlacedEquipment,
} from "./connection-binding";
import { connectionSceneToSvg } from "./connection-to-svg";
import {
  BOUND_CONNECTION_SCENE,
  BOUND_CONNECTION_VIEWPORT,
} from "./bound-connection.fixture";

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

const SOURCE: PlacedEquipment = {
  elementId: "el-extraction",
  symbolId: "extraction-column",
  x: 40,
  y: 40,
  size: 100,
};
const TARGET: PlacedEquipment = {
  elementId: "el-tank",
  symbolId: "collection-tank",
  x: 240,
  y: 60,
  size: 100,
};

const PROCESS = {
  source: { element: SOURCE, portId: "right" },
  target: { element: TARGET, portId: "left" },
  connector: "process-line",
} as const;

describe("buildBoundConnection", () => {
  it("produces an arrow skeleton referencing both endpoint elements by id", () => {
    const arrow = buildBoundConnection(PROCESS) as unknown as {
      type: string;
      start: { id: string };
      end: { id: string };
    };
    expect(arrow.type).toBe("arrow");
    expect(arrow.start.id).toBe("el-extraction");
    expect(arrow.end.id).toBe("el-tank");
  });

  it("anchors the arrow at the source port with a delta to the target port", () => {
    const arrow = buildBoundConnection(PROCESS) as unknown as {
      x: number;
      y: number;
      points: [number, number][];
    };
    // extraction-column "right" = local (65,50) → scene (40+65, 40+50) = (105, 90).
    expect(arrow.x).toBe(105);
    expect(arrow.y).toBe(90);
    // collection-tank "left" = local (15,55) → scene (240+15, 60+55) = (255, 115).
    expect(arrow.points[0]).toEqual([0, 0]);
    expect(arrow.points[1]).toEqual([255 - 105, 115 - 90]);
  });

  it("marks a signal-line connection as a dashed stroke", () => {
    const arrow = buildBoundConnection({
      ...PROCESS,
      connector: "signal-line",
    }) as unknown as { strokeStyle: string };
    expect(arrow.strokeStyle).toBe("dashed");
  });

  it("marks a process-line connection as a solid stroke", () => {
    const arrow = buildBoundConnection(PROCESS) as unknown as {
      strokeStyle: string;
    };
    expect(arrow.strokeStyle).toBe("solid");
  });

  it("rejects a non-connector symbol as the connection type", () => {
    expect(() =>
      buildBoundConnection({ ...PROCESS, connector: "heater" }),
    ).toThrow(/not a connector/);
  });

  it("rejects a self-loop (both endpoints the same element)", () => {
    expect(() =>
      buildBoundConnection({
        source: { element: SOURCE, portId: "top" },
        target: { element: SOURCE, portId: "bottom" },
        connector: "process-line",
      }),
    ).toThrow(/distinct elements/);
  });

  it("rejects an unknown port id with the valid ports listed", () => {
    expect(() =>
      buildBoundConnection({
        source: { element: SOURCE, portId: "nope" },
        target: { element: TARGET, portId: "left" },
        connector: "process-line",
      }),
    ).toThrow(/Port 'nope' does not exist/);
  });
});

describe("bind-on-create skeleton contract (FR-3)", () => {
  // `convertToExcalidrawElements` reads `start.id` / `end.id` on an arrow
  // skeleton and sets the resulting arrow's startBinding/endBinding to those
  // elements (and registers the arrow in each target's boundElements). Asserting
  // the skeleton carries that exact contract proves the binding wiring without
  // loading the browser-only runtime; the live binding is asserted in Playwright.
  it("references both endpoint elements via start.id / end.id", () => {
    const arrow = buildBoundConnection(PROCESS) as unknown as {
      type: "arrow";
      start: { id: string };
      end: { id: string };
    };
    expect(arrow.type).toBe("arrow");
    expect(arrow.start).toEqual({ id: SOURCE.elementId });
    expect(arrow.end).toEqual({ id: TARGET.elementId });
  });

  it("never carries equipment metadata on the arrow (CLAUDE.md fact #1)", () => {
    const arrow = buildBoundConnection(PROCESS) as unknown as Record<
      string,
      unknown
    >;
    expect(arrow.customData).toBeUndefined();
  });
});

describe("bound-connection scene — golden SVG (🟡 visual diff)", () => {
  it("renders two equipment + bound connection matching its golden fixture", () => {
    const rendered = connectionSceneToSvg(
      BOUND_CONNECTION_SCENE,
      BOUND_CONNECTION_VIEWPORT,
    );
    const golden = readFileSync(
      join(goldenDir, "bound-connection-scene.svg"),
      "utf8",
    );
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });
});
