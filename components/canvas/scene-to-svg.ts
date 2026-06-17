// Deterministic SVG renderer for a placed-symbol Excalidraw scene (DEV-1137 🟡).
//
// Why this exists: the canvas acceptance criterion is "screenshot golden compare
// for a placed-symbol scene." A pixel screenshot of a live Excalidraw canvas is
// non-deterministic (fonts, hand-drawn roughness seed, antialiasing) and needs a
// browser, so it is not loop-closable in CI. The server-side SVG render harness
// is DEV-1142. For Phase 1's minimal 🟡 compare we follow the DEV-1131 pattern:
// render the SAME element skeletons we hand to Excalidraw into a normalized,
// byte-stable SVG and golden-compare it. This proves the placement geometry —
// the thing this task actually owns — is correct and unchanged.
//
// This consumes the `ExcalidrawElementSkeleton`s produced by symbolToSkeletons,
// so the golden tracks exactly what gets placed on the canvas.

import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

const STROKE = "#1e1e1e";
const STROKE_WIDTH = 2;
const DASH = "6 4";

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function commonAttrs(strokeStyle: string | undefined): string {
  const dash = strokeStyle === "dashed" ? ` stroke-dasharray="${DASH}"` : "";
  return `fill="none" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}"${dash}`;
}

function renderSkeleton(el: ExcalidrawElementSkeleton): string {
  const attrs = commonAttrs(
    (el as { strokeStyle?: string }).strokeStyle,
  );
  switch (el.type) {
    case "rectangle": {
      const { x, y, width = 0, height = 0 } = el;
      return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" ${attrs}/>`;
    }
    case "ellipse": {
      const { x, y, width = 0, height = 0 } = el;
      const cx = x + width / 2;
      const cy = y + height / 2;
      return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(width / 2)}" ry="${fmt(height / 2)}" ${attrs}/>`;
    }
    case "diamond": {
      const { x, y, width = 0, height = 0 } = el;
      const cx = x + width / 2;
      const cy = y + height / 2;
      const pts = [
        [cx, y],
        [x + width, cy],
        [cx, y + height],
        [x, cy],
      ]
        .map(([px, py]) => `${fmt(px ?? 0)},${fmt(py ?? 0)}`)
        .join(" ");
      return `<polygon points="${pts}" ${attrs}/>`;
    }
    case "line": {
      const { x, y } = el;
      const points = (el as { points?: readonly (readonly number[])[] }).points ?? [];
      const pts = points
        .map((pt) => `${fmt(x + (pt[0] ?? 0))},${fmt(y + (pt[1] ?? 0))}`)
        .join(" ");
      return `<polyline points="${pts}" ${attrs}/>`;
    }
    default:
      // Placed symbols only emit the geometry above. A new skeleton type means
      // a placement bug, not a render gap — fail loudly.
      throw new Error(`Unhandled skeleton type in scene render: ${el.type}`);
  }
}

/**
 * Render a list of placed element skeletons to a deterministic, normalized SVG.
 * Output is stable (fixed precision, no locale) and safe to commit as a golden.
 */
export function sceneToSvg(
  elements: readonly ExcalidrawElementSkeleton[],
  viewport: { readonly width: number; readonly height: number },
): string {
  const body = elements.map(renderSkeleton).join("\n  ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" data-scene="placed-symbols">`,
    `  ${body}`,
    `</svg>`,
    "",
  ].join("\n");
}
