// Deterministic SVG renderer for a SyncScene (DEV-1152 🟡).
//
// Why this exists: DEV-1152 is a 🟡 task — "done" needs a rendered artifact
// golden-compared to a committed fixture, the same loop-closer the other Phase-1
// canvas tasks use. The guard's observable output is the SCENE the canvas shows
// after a concurrent broadcast + drag is reconciled. A live Excalidraw screenshot
// is non-deterministic and browser-bound; instead we render the guard's resolved
// SyncScene into a normalized, byte-stable SVG and golden-compare it. The golden
// thus encodes the contract visually: after release, the deferred authoritative
// broadcast (not the discarded in-progress drag) is what renders.
//
// Pure and side-effect-free: identical scene in → byte-identical SVG out.

import type { SyncScene } from "./types";

const STROKE = "#1e1e1e";
const STROKE_WIDTH = 2;
const ELEMENT_SIZE = 40;

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render a SyncScene to a deterministic, normalized SVG. Each element is a fixed
 * box at its (x, y) carrying its id (and label, if any) as data-attributes and a
 * text node, so the golden tracks exactly which elements are present and where —
 * the thing a stomped-vs-preserved edit changes.
 */
export function syncSceneToSvg(
  s: SyncScene,
  viewport: { readonly width: number; readonly height: number },
): string {
  const attrs = `fill="none" stroke="${STROKE}" stroke-width="${STROKE_WIDTH}"`;
  const body = s.elements
    .map((el) => {
      const label = el.label === undefined ? "" : escapeText(el.label);
      const rect = `<rect data-id="${escapeText(el.id)}" x="${fmt(el.x)}" y="${fmt(el.y)}" width="${ELEMENT_SIZE}" height="${ELEMENT_SIZE}" ${attrs}/>`;
      const text = `<text data-id="${escapeText(el.id)}" x="${fmt(el.x)}" y="${fmt(el.y)}" fill="${STROKE}">${escapeText(el.id)}${label === "" ? "" : `:${label}`}</text>`;
      return `${rect}\n  ${text}`;
    })
    .join("\n  ");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewport.width} ${viewport.height}" data-scene="sync" data-rev="${s.rev}">`,
    `  ${body}`,
    `</svg>`,
    "",
  ].join("\n");
}
