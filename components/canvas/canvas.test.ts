// Tests for the canvas placement layer (DEV-1137, FR-1/FR-2).
//
// Two acceptance criteria are exercised here without a browser:
//   - symbolToSkeletons maps the symbol library into Excalidraw skeletons with
//     correct placement/scaling (the geometry the canvas places).
//   - 🟡 golden: a fixed placed-symbol scene renders byte-stable SVG matching a
//     committed fixture (test/golden/canvas-placed-scene.svg).
//
// Browser-bound criteria (canvas renders client-side without SSR crash; native
// place/move/resize/rotate/delete/label interactions) are covered by the
// Playwright E2E spec (e2e/canvas.spec.ts), which is the only place a real
// Excalidraw mount can be asserted.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { getSymbol } from "@/lib/symbols";
import {
  DEFAULT_PLACEMENT_SIZE,
  symbolToSkeletons,
} from "./symbol-to-skeleton";
import { sceneToSvg } from "./scene-to-svg";
import { PLACED_SCENE, PLACED_SCENE_VIEWPORT } from "./placed-scene.fixture";

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

describe("symbolToSkeletons", () => {
  it("places a rectangle symbol at the requested origin and size", () => {
    const skeletons = symbolToSkeletons(getSymbol("collection-tank"), {
      x: 200,
      y: 100,
      size: 100,
    });
    const rect = skeletons[0];
    // collection-tank primitive: rect at local (15,30) 70x50 → scaled by size/100.
    expect(rect).toMatchObject({
      type: "rectangle",
      x: 215,
      y: 130,
      width: 70,
      height: 50,
    });
  });

  it("scales geometry by the placement size", () => {
    const small = symbolToSkeletons(getSymbol("collection-tank"), {
      x: 0,
      y: 0,
      size: 50,
    })[0] as { width: number; height: number };
    // 70x50 local at size 50 → 35x25.
    expect(small.width).toBe(35);
    expect(small.height).toBe(25);
  });

  it("defaults to DEFAULT_PLACEMENT_SIZE when size is omitted", () => {
    const def = symbolToSkeletons(getSymbol("heater"), { x: 0, y: 0 })[0] as {
      width: number;
    };
    // heater ellipse is 60 wide locally → 60 at default size 100.
    expect(DEFAULT_PLACEMENT_SIZE).toBe(100);
    expect(def.width).toBe(60);
  });

  it("emits triangles as closed line skeletons with relative points", () => {
    const skeletons = symbolToSkeletons(getSymbol("gate-valve"), {
      x: 0,
      y: 0,
      size: 100,
    });
    const tri = skeletons[0] as unknown as {
      type: string;
      points: [number, number][];
    };
    expect(tri.type).toBe("line");
    // First point is the anchor (relative 0,0); path closes back to it.
    expect(tri.points[0]).toEqual([0, 0]);
    expect(tri.points[tri.points.length - 1]).toEqual([0, 0]);
  });

  it("marks dashed primitives (signal line) as dashed strokes", () => {
    const skeletons = symbolToSkeletons(getSymbol("signal-line"), {
      x: 0,
      y: 0,
    });
    expect((skeletons[0] as { strokeStyle?: string }).strokeStyle).toBe("dashed");
  });
});

describe("placed-symbol scene — golden SVG (🟡 visual diff)", () => {
  it("renders the canonical placed scene matching its golden fixture", () => {
    const skeletons = PLACED_SCENE.flatMap((placement) =>
      symbolToSkeletons(getSymbol(placement.symbolId), placement),
    );
    const rendered = sceneToSvg(skeletons, PLACED_SCENE_VIEWPORT);
    const golden = readFileSync(
      join(goldenDir, "canvas-placed-scene.svg"),
      "utf8",
    );
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });
});
