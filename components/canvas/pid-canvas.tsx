"use client";

/**
 * Excalidraw canvas wrapper (DEV-1137, FR-1/FR-2).
 *
 * Mounts the Excalidraw editor and exposes symbol placement. The user gets
 * Excalidraw's native place/move/resize/rotate/delete/label interactions for
 * free once elements are on the scene; the palette adds symbol-aware placement
 * on top.
 *
 * Placement path (per architecture decision in PRD §4): build element skeletons
 * → `convertToExcalidrawElements` → `updateScene`. Reads go through `onChange`.
 *
 * NOTE: this module is `"use client"` but is itself imported via
 * `dynamic(..., { ssr:false })` from the route (DEV-1137 owns app/(canvas)),
 * because Excalidraw crashes under SSR (CLAUDE.md fact #2).
 *
 * NOTE (CLAUDE.md fact #1 / architecture invariant): no equipment metadata is
 * attached to elements here. `convertToExcalidrawElements` drops `customData`;
 * the parallel metadata store (DEV-1136) is the source of truth for metadata,
 * and canonical diagram state lives server-side (DEV-1135). This component holds
 * only presentational canvas state.
 */
import { useCallback, useRef } from "react";
import {
  Excalidraw,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getSymbol, type SymbolId } from "@/lib/symbols";
import { EquipmentPalette } from "./equipment-palette";
import { symbolToSkeletons } from "./symbol-to-skeleton";

/** Local-space step used to stagger successive placements so they do not stack. */
const PLACE_STEP = 40;

export function PidCanvas() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const placeCountRef = useRef(0);

  const handlePlace = useCallback((id: SymbolId) => {
    const api = apiRef.current;
    if (api === null) {
      return;
    }
    // Stagger placements diagonally from a fixed origin so repeated clicks are
    // all visible rather than stacking on top of one another.
    const n = placeCountRef.current;
    placeCountRef.current = n + 1;
    const skeletons = symbolToSkeletons(getSymbol(id), {
      x: 120 + n * PLACE_STEP,
      y: 120 + n * PLACE_STEP,
    });
    const placed = convertToExcalidrawElements(skeletons);
    const existing = api.getSceneElements();
    api.updateScene({ elements: [...existing, ...placed] });
    api.scrollToContent(placed, { fitToContent: true });
  }, []);

  return (
    <div className="flex h-screen w-screen">
      <EquipmentPalette onPlace={handlePlace} />
      <div className="relative flex-1" data-testid="pid-canvas-mount">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
        />
      </div>
    </div>
  );
}
