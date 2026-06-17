// Canonical placed-symbol scene used by the 🟡 golden snapshot (DEV-1137).
//
// A small, fixed arrangement of representative symbols (a vessel, an exchanger,
// a valve, and a connector) at deterministic coordinates. Shared by the canvas
// test (golden compare) and the canvas demo seed so the snapshot tracks exactly
// what the editor places. Pure data — no imports beyond the symbol id type.

import type { SymbolId } from "@/lib/symbols";
import type { PlacementOptions } from "./symbol-to-skeleton";

export interface PlacedSymbol extends PlacementOptions {
  readonly symbolId: SymbolId;
}

/** Fixed placement set; coordinates chosen so symbols do not overlap. */
export const PLACED_SCENE: readonly PlacedSymbol[] = [
  { symbolId: "extraction-column", x: 40, y: 40, size: 100 },
  { symbolId: "heater", x: 200, y: 40, size: 100 },
  { symbolId: "gate-valve", x: 360, y: 40, size: 100 },
  { symbolId: "process-line", x: 40, y: 200, size: 100 },
];

/** Viewport the golden SVG is rendered into. */
export const PLACED_SCENE_VIEWPORT = { width: 520, height: 360 } as const;
