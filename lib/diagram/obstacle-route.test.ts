// Obstacle-avoidance routing (DEV-1210, 🟡).
//
// Asserts a run whose straight path would cross a third piece of equipment bends
// AROUND it, both at the pure-router level and through the SVG render (golden).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  bodyBoxFromPlacement,
  routeAvoiding,
  routeHitsObstacles,
} from "./orthogonal-route";
import { renderDiagramSvg } from "./render-svg";
import {
  OBSTACLE_ROUTE_RENDER_STATE,
  OBSTACLE_SCENE,
} from "./obstacle-route.fixture";

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

describe("obstacle-avoidance routing", () => {
  it("bends a run around a vessel on its straight path", () => {
    const { line, blocker } = OBSTACLE_SCENE;
    const blockerBox = bodyBoxFromPlacement(
      blocker.symbolId,
      blocker.x,
      blocker.y,
      blocker.size,
    );
    const start = line.start!;
    const end = line.end!;
    const route = routeAvoiding(start, "h", end, "h", [blockerBox]);

    expect(route[0]).toEqual(start);
    expect(route[route.length - 1]).toEqual(end);
    expect(route.length).toBeGreaterThan(2); // it had to detour
    expect(routeHitsObstacles(route, [blockerBox])).toBe(false);
    // Strictly orthogonal.
    for (let i = 1; i < route.length; i += 1) {
      const dx = route[i].x - route[i - 1].x;
      const dy = route[i].y - route[i - 1].y;
      expect(dx === 0 || dy === 0).toBe(true);
    }
  });

  it("renders the detour matching its golden fixture", () => {
    const rendered = renderDiagramSvg(OBSTACLE_ROUTE_RENDER_STATE);
    const golden = readFileSync(join(goldenDir, "obstacle-route.svg"), "utf8");
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });
});
