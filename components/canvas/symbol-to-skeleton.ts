// Map a symbol-library definition (DEV-1131) to Excalidraw element skeletons
// for on-canvas placement (DEV-1137, FR-1/FR-2).
//
// This is the canvas-layer adapter: the symbol library declares geometry in a
// 100x100 local box; here we translate that into the `ExcalidrawElementSkeleton`
// shapes that `convertToExcalidrawElements` consumes, offset to a placement
// origin and scaled to a placement size.
//
// IMPORTANT (CLAUDE.md fact #1): `convertToExcalidrawElements` DROPS `customData`.
// Equipment metadata (tag, type, required attributes) is NEVER carried here — it
// lives in the parallel metadata store keyed by element id (DEV-1136). These
// skeletons are purely presentational geometry. This module performs no I/O and
// holds no state, so it is unit- and golden-testable without a browser.

import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type { SymbolDefinition, SymbolPrimitive } from "@/lib/symbols";
import { TECHNICAL_SHAPE_STYLE } from "./draw-style";

/** Symbol-library local box edge length; every primitive is authored in 0..100. */
const LOCAL_BOX = 100;

/** Default on-canvas footprint (px) for a placed symbol when no size is given. */
export const DEFAULT_PLACEMENT_SIZE = 100;

/** Where and how large to place a symbol on the canvas. */
export interface PlacementOptions {
  /** Scene-space x of the placement box top-left. */
  readonly x: number;
  /** Scene-space y of the placement box top-left. */
  readonly y: number;
  /** Edge length (px) of the square the 100x100 local box maps onto. */
  readonly size?: number;
}

/** Scale a local-space coordinate (0..LOCAL_BOX) into placed scene space. */
function scale(local: number, origin: number, size: number): number {
  return origin + (local / LOCAL_BOX) * size;
}

/**
 * Convert a single primitive into one Excalidraw element skeleton.
 *
 * - rectangle / ellipse / diamond → the matching generic element.
 * - line → a `line` skeleton with scaled relative points.
 * - triangle → a closed `line` skeleton (Excalidraw has no triangle primitive);
 *   the polygon points are scaled and the path is closed back to its start so it
 *   renders as a complete triangle outline.
 */
function primitiveToSkeleton(
  p: SymbolPrimitive,
  origin: { x: number; y: number },
  size: number,
): ExcalidrawElementSkeleton {
  const strokeStyle = p.dashed ? "dashed" : "solid";

  if (p.shape === "line" || p.shape === "triangle") {
    const pts = p.points ?? [];
    const anchor = pts[0];
    if (anchor === undefined) {
      throw new Error(`Primitive '${p.shape}' requires at least one point`);
    }
    // Excalidraw line points are relative to the element's (x, y) anchor.
    const ax = scale(anchor[0], origin.x, size);
    const ay = scale(anchor[1], origin.y, size);
    const rel: [number, number][] = pts.map(([px, py]) => [
      ((px - anchor[0]) / LOCAL_BOX) * size,
      ((py - anchor[1]) / LOCAL_BOX) * size,
    ]);
    // Close triangles back to the start so the outline is complete.
    if (p.shape === "triangle") {
      rel.push([0, 0]);
    }
    return {
      type: "line",
      x: ax,
      y: ay,
      points: rel,
      strokeStyle,
      ...TECHNICAL_SHAPE_STYLE,
    };
  }

  return {
    type: p.shape,
    x: scale(p.x, origin.x, size),
    y: scale(p.y, origin.y, size),
    width: (p.width / LOCAL_BOX) * size,
    height: (p.height / LOCAL_BOX) * size,
    strokeStyle,
    ...TECHNICAL_SHAPE_STYLE,
  };
}

/**
 * Convert a symbol definition into Excalidraw element skeletons, placed at the
 * given origin and scaled to `size`. The returned skeletons are ready to pass to
 * `convertToExcalidrawElements`. Deterministic and pure: identical inputs always
 * yield byte-identical output (enables the golden snapshot test).
 */
export function symbolToSkeletons(
  def: SymbolDefinition,
  placement: PlacementOptions,
): ExcalidrawElementSkeleton[] {
  const size = placement.size ?? DEFAULT_PLACEMENT_SIZE;
  const origin = { x: placement.x, y: placement.y };
  return def.primitives.map((p) => primitiveToSkeleton(p, origin, size));
}
