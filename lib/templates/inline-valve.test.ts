// Inline-valve geometry (DEV-1211, 🟡).
//
// Asserts the pure helper centres a valve on a horizontal run and keeps both pipe
// halves colinear through it, plus a golden compare proving the rendered SVG
// matches (canvas + SVG share the router, so the golden also guards the canvas).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { at, place, inlineValve } from "./build";
import { renderDiagramSvg } from "@/lib/diagram/render-svg";
import { INLINE_VALVE_RENDER_STATE } from "./inline-valve.fixture";

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

// Two tanks on a horizontal run (both "right"/"left" ports at scene y=95).
const TANK_A = place("eq-tank-a", "collection-tank", 40, 40, { tag: "TK-1" });
const TANK_B = place("eq-tank-b", "collection-tank", 340, 40, { tag: "TK-2" });
const RUN_Y = 95;

describe("inlineValve", () => {
  it("centres the valve on the run with both halves colinear", () => {
    const { valve, segments } = inlineValve(
      "eq-bv",
      "ball-valve",
      at(TANK_A, "right"),
      at(TANK_B, "left"),
      { attributes: { tag: "BV-1" } },
    );
    const [seg1, seg2] = segments;

    // Valve body centred at the run midpoint (x = (125+355)/2 = 240) and on the run.
    expect(valve.symbolId).toBe("ball-valve");
    expect(valve.x + valve.size / 2).toBe(240);
    expect(valve.y + valve.size / 2).toBe(RUN_Y);

    // All four segment endpoints sit on the run's y → two colinear segments.
    for (const p of [seg1.start, seg1.end, seg2.start, seg2.end]) {
      expect(p?.y).toBe(RUN_Y);
    }
    // Entry segment runs from the tank into the valve's left port; exit leaves the
    // right port to the other tank — no gap, no jog.
    expect(seg1.start).toEqual({ x: 125, y: RUN_Y });
    expect(seg1.end).toEqual({ x: 210, y: RUN_Y });
    expect(seg2.start).toEqual({ x: 270, y: RUN_Y });
    expect(seg2.end).toEqual({ x: 355, y: RUN_Y });
  });

  it("binds the two segments through the valve", () => {
    const { valve, segments } = inlineValve(
      "eq-bv",
      "ball-valve",
      at(TANK_A, "right"),
      at(TANK_B, "left"),
    );
    const [seg1, seg2] = segments;
    expect(seg1.elementId).toBe("eq-bv-in");
    expect(seg2.elementId).toBe("eq-bv-out");
    expect(seg1.sourceElementId).toBe(TANK_A.elementId);
    expect(seg1.targetElementId).toBe(valve.elementId);
    expect(seg2.sourceElementId).toBe(valve.elementId);
    expect(seg2.targetElementId).toBe(TANK_B.elementId);
  });

  it("honours the `at` position along the run", () => {
    const { valve } = inlineValve(
      "eq-bv",
      "ball-valve",
      at(TANK_A, "right"),
      at(TANK_B, "left"),
      { at: 0.25 },
    );
    // cx = 125 + (355-125)*0.25 = 182.5
    expect(valve.x + valve.size / 2).toBe(182.5);
  });

  it("orients entry toward `from` when the run goes right→left", () => {
    // Swap roles: from = TANK_B (on the right), to = TANK_A (on the left).
    const { segments } = inlineValve(
      "eq-bv",
      "ball-valve",
      at(TANK_B, "left"),
      at(TANK_A, "right"),
    );
    const [seg1, seg2] = segments;
    // Entry leaves TANK_B's left port (355) and enters the valve's RIGHT port (270);
    // both segments still colinear on the run.
    expect(seg1.start).toEqual({ x: 355, y: RUN_Y });
    expect(seg1.end).toEqual({ x: 270, y: RUN_Y });
    expect(seg2.start).toEqual({ x: 210, y: RUN_Y });
    expect(seg2.end).toEqual({ x: 125, y: RUN_Y });
  });

  it("rejects a non-horizontal run (valve cannot rotate in v1)", () => {
    const TANK_BELOW = place("eq-tank-c", "collection-tank", 40, 240, {});
    expect(() =>
      inlineValve("eq-bv", "ball-valve", at(TANK_A, "bottom"), at(TANK_BELOW, "top")),
    ).toThrow(/horizontal run/);
  });

  it("rejects an out-of-range position", () => {
    expect(() =>
      inlineValve("eq-bv", "ball-valve", at(TANK_A, "right"), at(TANK_B, "left"), {
        at: 1.5,
      }),
    ).toThrow(/\[0,1\]/);
  });
});

describe("inlineValve — golden compare (🟡 visual diff)", () => {
  it("renders the inline-valve run matching its golden fixture", () => {
    const rendered = renderDiagramSvg(INLINE_VALVE_RENDER_STATE);
    const golden = readFileSync(join(goldenDir, "inline-valve.svg"), "utf8");
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });
});
