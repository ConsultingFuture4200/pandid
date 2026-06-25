// Deterministic SVG renderer for symbol skeletons.
//
// Purpose (DEV-1131 🟡): produce a byte-stable golden artifact per symbol so the
// visual-diff harness can assert rendered output matches a checked-in fixture.
// This is NOT the canvas renderer — Excalidraw owns on-canvas rendering at
// DEV-1137. This renderer is intentionally minimal, dependency-free, and pure so
// goldens are reproducible across machines without a browser.

import type { SymbolDefinition, SymbolPrimitive } from "./types";

/** Local symbol box edge length; every symbol is authored in 0..100 local space. */
const BOX = 100;
const STROKE = "#1e1e1e";
const STROKE_WIDTH = 2;
const DASH = "6 4";

function fmt(n: number): string {
  // Stable numeric formatting: integers stay integers, no locale, no trailing noise.
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function renderPrimitive(p: SymbolPrimitive): string {
  const dash = p.dashed ? ` stroke-dasharray="${DASH}"` : "";
  const fill = p.filled === true ? STROKE : "none";
  const common = `fill="${fill}" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}"${dash}`;
  switch (p.shape) {
    case "rectangle":
      return `<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.width)}" height="${fmt(p.height)}" ${common}/>`;
    case "ellipse": {
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      return `<ellipse cx="${fmt(cx)}" cy="${fmt(cy)}" rx="${fmt(p.width / 2)}" ry="${fmt(p.height / 2)}" ${common}/>`;
    }
    case "diamond": {
      const cx = p.x + p.width / 2;
      const cy = p.y + p.height / 2;
      const pts = [
        [cx, p.y],
        [p.x + p.width, cy],
        [cx, p.y + p.height],
        [p.x, cy],
      ]
        .map(([px, py]) => `${fmt(px ?? 0)},${fmt(py ?? 0)}`)
        .join(" ");
      return `<polygon points="${pts}" ${common}/>`;
    }
    case "triangle": {
      const pts = (p.points ?? [])
        .map(([px, py]) => `${fmt(px)},${fmt(py)}`)
        .join(" ");
      return `<polygon points="${pts}" ${common}/>`;
    }
    case "line": {
      const pts = (p.points ?? [])
        .map(([px, py]) => `${fmt(px)},${fmt(py)}`)
        .join(" ");
      return `<polyline points="${pts}" ${common}/>`;
    }
    default: {
      // Exhaustiveness guard: a new PrimitiveShape must be handled here.
      const exhaustive: never = p.shape;
      throw new Error(`Unhandled primitive shape: ${String(exhaustive)}`);
    }
  }
}

/**
 * Render a symbol's skeleton to a deterministic, normalized SVG string.
 * Output is stable (sorted attributes, fixed precision) so it can be committed
 * as a golden fixture and byte-compared.
 */
export function renderSymbolSvg(def: SymbolDefinition): string {
  const body = def.primitives.map(renderPrimitive).join("\n  ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOX} ${BOX}" data-symbol="${def.id}">`,
    `  ${body}`,
    `</svg>`,
    "",
  ].join("\n");
}
