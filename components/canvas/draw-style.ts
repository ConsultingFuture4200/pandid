// Technical / engineering render style for the live Excalidraw canvas (DEV-1200).
//
// Excalidraw defaults to a HAND-DRAWN look (`roughness: 1`, rounded corners) —
// the "pen stroke" sketchy vibe. P&IDs want the opposite: crisp, straight,
// CAD-like geometry. These property bags are spread onto every skeleton we build
// (equipment bodies, connector lines) so the canvas renders technical, not
// sketchy. Pure data — no Excalidraw runtime here; the SVG/golden renderers are
// already clean and unaffected.
//
//   - roughness 0  → architect (the cleanest Excalidraw offers; no wobble)
//   - roundness null → sharp corners (vessels/boxes are not rounded rectangles)
//   - strokeWidth 1 → thin, consistent instrument-drawing line weight
//   - solid strokes by default (dashed is opt-in per primitive, e.g. signal lines)

/** Shared base for every technical element: clean, sharp, thin. */
const TECHNICAL_BASE = {
  roughness: 0,
  roundness: null,
  strokeWidth: 1,
} as const;

/** Style for equipment-body shapes (rectangle / ellipse / diamond / line). */
export const TECHNICAL_SHAPE_STYLE = TECHNICAL_BASE;

/**
 * Style for a connector arrow. Process/signal lines read as PIPES, not annotated
 * arrows, so the sketchy arrowheads are dropped — a plain, sharp, solid (or
 * dashed) line. Binding still works: an arrow with null arrowheads is still an
 * arrow element, so it tracks node moves (DEV-1193).
 */
export const TECHNICAL_CONNECTOR_STYLE = {
  ...TECHNICAL_BASE,
  startArrowhead: null,
  endArrowhead: null,
} as const;
