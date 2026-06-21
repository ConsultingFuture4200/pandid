"use client";

/**
 * Excalidraw canvas wrapper (DEV-1137, FR-1/FR-2; wired to a real diagram here).
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
 * `dynamic(..., { ssr:false })` from the editor shell, because Excalidraw crashes
 * under SSR (CLAUDE.md fact #2).
 *
 * CONTROLLED against canonical state (this task): the canvas is initialized from a
 * server-loaded {@link PlacementModel} (the latest committed version, rebuilt from
 * the `pid` projection + parallel metadata store), and reports model changes up so
 * the shell can save them through the SINGLE commit pipeline. The structural model
 * — not Excalidraw's element list — is the unit that round-trips to canonical
 * state, because `convertToExcalidrawElements` drops `customData` (CLAUDE.md fact
 * #1) and equipment metadata lives only in the parallel store.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  Excalidraw,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { getSymbol, getRequiredAttributes, type SymbolId } from "@/lib/symbols";
import { EquipmentPalette } from "./equipment-palette";
import { symbolToSkeletons } from "./symbol-to-skeleton";
import type { PlacedNode, PlacementModel } from "./placement-model";

/** Local-space step used to stagger successive placements so they do not stack. */
const PLACE_STEP = 40;
/** Default footprint of a freshly placed symbol (matches the symbol render box). */
const PLACE_SIZE = 100;

interface PidCanvasProps {
  /** The committed model to initialize the canvas from (server-loaded). */
  readonly initialModel: PlacementModel;
  /** Called whenever the structural model changes (e.g. a placement) so the
   * shell can offer to save it through the commit pipeline. */
  readonly onModelChange: (model: PlacementModel) => void;
  /** Called when the canvas selection changes to a single equipment node (its
   * element id) or to nothing/multiple (null), so the shell can show/hide the
   * attribute editor for the selected node. */
  readonly onSelectionChange?: (selectedNodeId: string | null) => void;
}

/**
 * Render a node's equipment body onto the scene, returning the scene elements.
 * `convertToExcalidrawElements` assigns each element its own id, unrelated to the
 * node's `elementId`; the caller records the resulting ids → node mapping so a
 * later selection of any of a node's shapes resolves back to that node.
 */
function nodeToSceneElements(
  node: PlacedNode,
): readonly OrderedExcalidrawElement[] {
  return convertToExcalidrawElements(
    symbolToSkeletons(getSymbol(node.symbolId), {
      x: node.x,
      y: node.y,
      size: node.size,
    }),
  );
}

/** Seed default attributes for a freshly placed symbol: its required-attribute
 * keys blank (the human fills them before a valid save) plus an empty tag, so the
 * element exists in the model immediately and the validator can report exactly
 * what is missing rather than the element being absent. */
function defaultAttributes(symbolId: SymbolId): Record<string, string> {
  const attrs: Record<string, string> = { tag: "" };
  for (const required of getRequiredAttributes(symbolId)) {
    attrs[required.key] = "";
  }
  return attrs;
}

export function PidCanvas({
  initialModel,
  onModelChange,
  onSelectionChange,
}: PidCanvasProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // The structural model is the source of truth for what is committed; mirror it
  // in a ref so placement handlers append without stale closures.
  const modelRef = useRef<PlacementModel>(initialModel);
  const placeCountRef = useRef(0);
  // Scene-element id → owning node element id. Excalidraw selection reports its
  // own element ids; this map resolves a selected shape back to its PlacedNode
  // (a node may render to several shapes, all pointing at the same node id).
  const sceneToNodeRef = useRef<Map<string, string>>(new Map());
  // Last reported selection, so onChange only fires onSelectionChange on a real
  // transition (Excalidraw's onChange fires on every interaction).
  const lastSelectionRef = useRef<string | null>(null);

  // Render a committed model onto the canvas (once the API is available),
  // rebuilding the scene-element → node map from scratch (server-authoritative).
  const renderModel = useCallback((model: PlacementModel) => {
    const api = apiRef.current;
    if (api === null) {
      return;
    }
    const map = new Map<string, string>();
    const elements = model.nodes.flatMap((node) => {
      const placed = nodeToSceneElements(node);
      for (const element of placed) {
        map.set(element.id, node.elementId);
      }
      return placed;
    });
    sceneToNodeRef.current = map;
    api.updateScene({ elements });
  }, []);

  // Resolve the canvas selection to a single owned node id, or null when nothing
  // (or more than one distinct node) is selected. Drives the attribute panel.
  const resolveSelectedNode = useCallback(
    (selectedElementIds: AppState["selectedElementIds"]): string | null => {
      const owners = new Set<string>();
      for (const sceneId of Object.keys(selectedElementIds)) {
        const owner = sceneToNodeRef.current.get(sceneId);
        if (owner !== undefined) {
          owners.add(owner);
        }
      }
      return owners.size === 1 ? [...owners][0] : null;
    },
    [],
  );

  const handleChange = useCallback(
    (_elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
      if (onSelectionChange === undefined) {
        return;
      }
      const selected = resolveSelectedNode(appState.selectedElementIds);
      if (selected !== lastSelectionRef.current) {
        lastSelectionRef.current = selected;
        onSelectionChange(selected);
      }
    },
    [onSelectionChange, resolveSelectedNode],
  );

  // When the server hands a freshly loaded/refreshed model, replace the canvas
  // from canonical state (never merge — server is the single source of truth).
  useEffect(() => {
    modelRef.current = initialModel;
    placeCountRef.current = 0;
    renderModel(initialModel);
  }, [initialModel, renderModel]);

  const handlePlace = useCallback(
    (id: SymbolId) => {
      const api = apiRef.current;
      if (api === null) {
        return;
      }
      // Connectors are edges, not placeable nodes from the palette (manual
      // connect lives in connection-binding); ignore a connector click here.
      if (id === "process-line" || id === "signal-line") {
        return;
      }

      // Stagger placements diagonally so repeated clicks are all visible.
      const n = placeCountRef.current;
      placeCountRef.current = n + 1;
      const origin = { x: 120 + n * PLACE_STEP, y: 120 + n * PLACE_STEP };

      const node: PlacedNode = {
        elementId: `el-${Date.now()}-${n}`,
        symbolId: id,
        x: origin.x,
        y: origin.y,
        size: PLACE_SIZE,
        attributes: defaultAttributes(id),
      };
      const next: PlacementModel = {
        ...modelRef.current,
        nodes: [...modelRef.current.nodes, node],
      };
      modelRef.current = next;

      const placed = nodeToSceneElements(node);
      // Record the new scene elements so selecting any of them resolves to this
      // node (append, since the rest of the scene is unchanged).
      for (const element of placed) {
        sceneToNodeRef.current.set(element.id, node.elementId);
      }
      const existing = api.getSceneElements();
      api.updateScene({ elements: [...existing, ...placed] });
      api.scrollToContent(placed, { fitToContent: true });

      onModelChange(next);
    },
    [onModelChange],
  );

  return (
    <div className="flex h-full w-full">
      <EquipmentPalette onPlace={handlePlace} />
      <div className="relative flex-1" data-testid="pid-canvas-mount">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
            renderModel(modelRef.current);
          }}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
