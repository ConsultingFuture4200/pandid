// Server-side SVG render tests (DEV-1142 🟡, FR-9).
//
// Acceptance (Linear DEV-1142):
//   - Given canonical state, produces valid SVG.
//   - Golden compare for a known diagram.
//   - pnpm test green.
//
// The golden compare follows the established Phase-1 pattern (normalize, then
// byte-compare to a committed fixture under test/golden). Normalization rounds
// floats and collapses whitespace so the golden survives trivial formatting
// churn while still catching any geometry/structure change.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderDiagramSvg, type DiagramRenderState } from "./render-svg";
import { RENDER_FIXTURE } from "./render-svg.fixture";

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

describe("renderDiagramSvg — valid SVG from canonical state", () => {
  it("emits a well-formed <svg> root with the declared viewport", () => {
    const svg = renderDiagramSvg(RENDER_FIXTURE);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 420 400"');
    // No NaN/undefined leaked into coordinates.
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it("renders every equipment body and its tag label", () => {
    const svg = renderDiagramSvg(RENDER_FIXTURE);
    // extraction-column + collection-tank are rectangles; instrument is ellipse.
    expect((svg.match(/<rect /g) ?? []).length).toBe(2);
    expect((svg.match(/<ellipse /g) ?? []).length).toBe(1);
    for (const tag of ["EX-101", "TK-101", "LT-1"]) {
      expect(svg).toContain(`data-tag="${tag}"`);
      expect(svg).toContain(`>${tag}</text>`);
    }
  });

  it("renders connections, with the signal line dashed and the process line solid", () => {
    const svg = renderDiagramSvg(RENDER_FIXTURE);
    const process = svg.match(/<polyline[^>]*data-connection="line-1"[^>]*>/);
    const signal = svg.match(/<polyline[^>]*data-connection="sig-1"[^>]*>/);
    expect(process).not.toBeNull();
    expect(signal).not.toBeNull();
    expect(process?.[0]).not.toContain("stroke-dasharray");
    expect(signal?.[0]).toContain("stroke-dasharray");
  });

  it("is deterministic: identical state yields byte-identical SVG", () => {
    expect(renderDiagramSvg(RENDER_FIXTURE)).toBe(
      renderDiagramSvg(RENDER_FIXTURE),
    );
  });

  it("escapes user-supplied tag text", () => {
    const state: DiagramRenderState = {
      equipment: [
        {
          elementId: "x",
          symbolId: "pump",
          x: 0,
          y: 0,
          tag: "<P&1>",
        },
      ],
      connections: [],
      viewport: { width: 100, height: 140 },
    };
    const svg = renderDiagramSvg(state);
    expect(svg).toContain("&lt;P&amp;1&gt;");
    expect(svg).not.toContain("<P&1>");
  });
});

describe("renderDiagramSvg — golden compare (🟡 visual diff)", () => {
  it("renders the known diagram matching its golden fixture", () => {
    const rendered = renderDiagramSvg(RENDER_FIXTURE);
    const golden = readFileSync(
      join(goldenDir, "canonical-diagram.svg"),
      "utf8",
    );
    expect(normalizeSvg(rendered)).toBe(normalizeSvg(golden));
  });
});
