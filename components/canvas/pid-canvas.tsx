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
import { useCallback, useEffect, useRef, useState } from "react";
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
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";

import { getSymbol, getRequiredAttributes, type SymbolId } from "@/lib/symbols";
import { EquipmentPalette } from "./equipment-palette";
import { symbolToSkeletons } from "./symbol-to-skeleton";
import {
  arrowEndpoints,
  arrowInteriorWaypoints,
  decideWaypointCapture,
  waypointsKey,
} from "./waypoint-capture";
import {
  modelToSceneSkeletons,
  nodeBodyBox,
  nodeLabelSkeleton,
  routeOrthogonalBetween,
  type BodyBox,
} from "./model-to-scene";
import {
  addEdge,
  buildManualEdge,
  type ConnectorSymbolId,
} from "./manual-connect";
import type { PlacedNode, PlacementModel } from "./placement-model";

/** The connector symbol ids that put the canvas into connect mode. */
const CONNECTOR_IDS = new Set<SymbolId>(["process-line", "signal-line"]);

function isConnectorId(id: SymbolId): id is ConnectorSymbolId {
  return CONNECTOR_IDS.has(id);
}

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
  /** Called when the canvas selection changes to a single element — an equipment
   * node OR a connection edge (its element id) — or to nothing/multiple (null),
   * so the shell can show/hide the attribute editor for the selected element. */
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
  // Group all of a node's shapes + its label so a freshly placed symbol moves as
  // ONE unit when dragged (DEV-1206), matching the reload path in
  // `modelToSceneSkeletons`. Without this, a multi-primitive symbol lands as
  // loose, individually-selectable parts.
  const groupIds = [`grp-${node.elementId}`];
  const skeletons: ExcalidrawElementSkeleton[] = [
    ...symbolToSkeletons(getSymbol(node.symbolId), {
      x: node.x,
      y: node.y,
      size: node.size,
    }),
    // The equipment label (tag or symbol name) so a freshly placed symbol reads.
    nodeLabelSkeleton(node, `${node.elementId}::label`),
  ];
  return convertToExcalidrawElements(
    skeletons.map(
      (skeleton) =>
        ({ ...skeleton, groupIds }) as ExcalidrawElementSkeleton,
    ),
  );
}

/** Set a bound arrow's binding `gap` to 0 so the line touches the symbol edge
 * (Excalidraw defaults to a few-px inset). No-op when the endpoint is unbound. */
function zeroBindingGap(binding: { gap: number } | null): void {
  if (binding !== null) {
    binding.gap = 0;
  }
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
  // Flips true once Excalidraw hands us its imperative API. We render the loaded
  // model from an EFFECT gated on this — NOT synchronously inside the
  // `excalidrawAPI` callback, which fires mid-mount before the scene is ready, so
  // an `updateScene` there is silently dropped (canvas stays blank).
  const [apiReady, setApiReady] = useState(false);
  // The structural model is the source of truth for what is committed; mirror it
  // in a ref so placement handlers append without stale closures.
  const modelRef = useRef<PlacementModel>(initialModel);
  const placeCountRef = useRef(0);
  const edgeCountRef = useRef(0);
  // Scene-element id → owning node element id. Excalidraw selection reports its
  // own element ids; this map resolves a selected shape back to its PlacedNode
  // (a node may render to several shapes, all pointing at the same node id).
  const sceneToNodeRef = useRef<Map<string, string>>(new Map());
  // Last reported selection, so onChange only fires onSelectionChange on a real
  // transition (Excalidraw's onChange fires on every interaction).
  const lastSelectionRef = useRef<string | null>(null);
  // Last-seen body centre per node, so the connection reflow (DEV-1204) only
  // re-routes when a node actually MOVED — and never loops on its own updateScene.
  const lastNodeCentreRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  // Stable handle to onModelChange so the move-sync callback's deps stay empty.
  const onModelChangeRef = useRef(onModelChange);
  useEffect(() => {
    onModelChangeRef.current = onModelChange;
  }, [onModelChange]);
  // Baseline for on-canvas waypoint capture (DEV-1210): the edge id + geometry
  // key seen when a point-edit session began, so merely inspecting an auto-routed
  // line doesn't lock it — only an actual drag captures.
  const waypointBaselineRef = useRef<{ id: string; key: string } | null>(null);

  // Manual-connect state (DEV-1194). When the human picks a connector from the
  // palette the canvas enters connect mode: the next two equipment clicks become
  // the source and target of a new bound connection. `connectMode` drives the
  // hint banner; the ref mirrors it for stale-closure-free reads inside onChange.
  const [connectMode, setConnectMode] = useState<ConnectorSymbolId | null>(null);
  // True once the source endpoint has been picked (drives the banner's prompt).
  const [sourcePicked, setSourcePicked] = useState(false);
  const connectModeRef = useRef<ConnectorSymbolId | null>(null);
  const pendingSourceRef = useRef<string | null>(null);

  const enterConnectMode = useCallback((connector: ConnectorSymbolId) => {
    connectModeRef.current = connector;
    pendingSourceRef.current = null;
    setConnectMode(connector);
    setSourcePicked(false);
    // Start from a clean selection so the first equipment click is unambiguous.
    apiRef.current?.updateScene({ appState: { selectedElementIds: {} } });
  }, []);

  const cancelConnectMode = useCallback(() => {
    connectModeRef.current = null;
    pendingSourceRef.current = null;
    setConnectMode(null);
    setSourcePicked(false);
  }, []);

  // Render a committed model onto the canvas (once the API is available),
  // rebuilding the scene-element → node map from scratch (server-authoritative).
  const renderModel = useCallback((model: PlacementModel) => {
    // Apply the scene AFTER Excalidraw finishes initializing. The
    // `excalidrawAPI` callback fires mid-mount, before Excalidraw applies its
    // (empty) initialData — so an `updateScene` on the same tick is wiped by that
    // init. Deferring across two animation frames runs the update after the
    // init clear AND after the canvas has laid out (so scrollToContent measures a
    // real size). Both the scene write and the fit happen here.
    const apply = () => {
      const api = apiRef.current;
      if (api === null) {
        return;
      }
      // Build the full skeleton list (equipment bodies + connection arrows) and
      // convert it in a SINGLE call so each arrow's `start`/`end` `{ id }`
      // bindings resolve against the node bodies and the drawn line FOLLOWS node
      // drags (DEV-1193). `regenerateIds: false` keeps the deterministic ids the
      // scene→node map is keyed on, so selection resolution needs no read-back.
      const { skeletons, sceneToOwner } = modelToSceneSkeletons(model);
      const elements = convertToExcalidrawElements([...skeletons], {
        regenerateIds: false,
      });
      // Bound connectors otherwise stop a few px short of the symbol (Excalidraw
      // insets a bound arrow by its binding `gap`); zero it so a pipe touches the
      // equipment edge like a real P&ID.
      for (const element of elements) {
        if (element.type === "arrow") {
          zeroBindingGap(element.startBinding);
          zeroBindingGap(element.endBinding);
        }
      }
      sceneToNodeRef.current = new Map(sceneToOwner);
      // Seed the reflow baseline from the rendered body centres so the first
      // onChange doesn't see a phantom "move" and re-route needlessly.
      lastNodeCentreRef.current = new Map(
        model.nodes.map((n) => {
          const box = nodeBodyBox(n);
          return [n.elementId, { x: box.cx, y: box.cy }] as const;
        }),
      );
      api.updateScene({ elements });
      if (elements.length > 0) {
        api.scrollToContent(elements, { fitToContent: true });
      }
    };
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }, []);

  // When a node is dragged on the canvas: (1) persist its new position into the
  // model so Save keeps it and a reload doesn't snap it back (DEV-1206), and
  // (2) re-route its connections as right-angle piping (DEV-1204) — Excalidraw
  // distorts a bound multi-point arrow on drag, so we recompute each connector's
  // orthogonal path from the nodes' LIVE body boxes. Guarded on node-centre
  // movement so it never loops on its own updateScene.
  const reflowConnections = useCallback(() => {
    const api = apiRef.current;
    if (api === null) {
      return;
    }
    const model = modelRef.current;
    const nodeIds = new Set(model.nodes.map((n) => n.elementId));
    const elements = api.getSceneElements();
    // Current body box per node = its first bindable shape on the live scene.
    const bodyByNode = new Map<string, BodyBox>();
    for (const el of elements) {
      const owner = sceneToNodeRef.current.get(el.id);
      if (owner === undefined || !nodeIds.has(owner) || bodyByNode.has(owner)) {
        continue;
      }
      if (
        el.type === "rectangle" ||
        el.type === "ellipse" ||
        el.type === "diamond"
      ) {
        bodyByNode.set(owner, {
          cx: el.x + el.width / 2,
          cy: el.y + el.height / 2,
          hx: el.width / 2,
          hy: el.height / 2,
        });
      }
    }
    let moved = false;
    for (const [id, box] of bodyByNode) {
      const last = lastNodeCentreRef.current.get(id);
      if (
        last === undefined ||
        Math.abs(last.x - box.cx) > 0.5 ||
        Math.abs(last.y - box.cy) > 0.5
      ) {
        moved = true;
        break;
      }
    }
    if (!moved) {
      return;
    }

    // (1) Persist the position delta into the model so Save commits it (DEV-1206).
    let modelChanged = false;
    const movedNodes = model.nodes.map((n) => {
      const box = bodyByNode.get(n.elementId);
      const last = lastNodeCentreRef.current.get(n.elementId);
      if (
        box === undefined ||
        last === undefined ||
        (Math.abs(last.x - box.cx) <= 0.5 && Math.abs(last.y - box.cy) <= 0.5)
      ) {
        return n;
      }
      modelChanged = true;
      return { ...n, x: n.x + (box.cx - last.x), y: n.y + (box.cy - last.y) };
    });
    if (modelChanged) {
      const nextModel: PlacementModel = { ...model, nodes: movedNodes };
      modelRef.current = nextModel;
      onModelChangeRef.current(nextModel);
    }

    // (2) Re-route connections orthogonally from the new positions (DEV-1204).
    const edgeById = new Map(model.edges.map((e) => [e.elementId, e] as const));
    const modelNodeById = new Map(
      model.nodes.map((node) => [node.elementId, node] as const),
    );
    // A node's box for routing: its LIVE scene body when the symbol has a bindable
    // shape, else its model placement box. The fallback matters because a symbol
    // drawn only from lines/triangles (expansion joint, gate/check valve) has no
    // bindable body, so an edge touching it is HALF-bound — Excalidraw distorts it
    // when the other end is dragged. Without the fallback this re-route skipped
    // such edges, leaving the distorted (often collapsed → invisible) arrow in
    // place; the model box lets us re-route it like any other connection.
    const boxFor = (nodeId: string | null): BodyBox | undefined => {
      if (nodeId === null) {
        return undefined;
      }
      const live = bodyByNode.get(nodeId);
      if (live !== undefined) {
        return live;
      }
      const node = modelNodeById.get(nodeId);
      return node === undefined ? undefined : nodeBodyBox(node);
    };
    let arrowsChanged = false;
    const next = elements.map((el) => {
      if (el.type !== "arrow") {
        return el;
      }
      const edge = edgeById.get(el.id);
      if (edge === undefined) {
        return el;
      }
      // An edge with explicit waypoints is user-routed (DEV-1210): leave its
      // geometry alone so the waypoints lock in place; Excalidraw still moves the
      // bound endpoints when a connected node is dragged.
      if (edge.waypoints !== undefined && edge.waypoints.length > 0) {
        return el;
      }
      const sBox = boxFor(edge.sourceElementId);
      const tBox = boxFor(edge.targetElementId);
      if (sBox === undefined || tBox === undefined) {
        return el;
      }
      arrowsChanged = true;
      const { x, y, points } = routeOrthogonalBetween(sBox, tBox);
      return { ...el, x, y, points } as typeof el;
    });
    lastNodeCentreRef.current = new Map(
      [...bodyByNode].map(([k, v]) => [k, { x: v.cx, y: v.cy }] as const),
    );
    if (arrowsChanged) {
      api.updateScene({ elements: next });
    }
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

  // Resolve a selection to an equipment NODE id only (not an edge), for picking
  // connection endpoints. Returns null if the selection is empty, multiple, or an
  // edge — connections join two distinct equipment nodes.
  const resolveSelectedNodeId = useCallback(
    (selectedElementIds: AppState["selectedElementIds"]): string | null => {
      const owner = resolveSelectedNode(selectedElementIds);
      if (owner === null) {
        return null;
      }
      return modelRef.current.nodes.some((n) => n.elementId === owner)
        ? owner
        : null;
    },
    [resolveSelectedNode],
  );

  // In connect mode, capture the source on the first equipment click and build a
  // bound connection to the second. Re-renders the model so the new edge binds in
  // a single conversion (DEV-1193), reports the change up, and exits connect mode.
  const handleConnectSelection = useCallback(
    (nodeId: string | null) => {
      if (nodeId === null) {
        return; // empty/multiple/edge selection — keep waiting.
      }
      if (pendingSourceRef.current === null) {
        pendingSourceRef.current = nodeId;
        setSourcePicked(true);
        return; // source captured; wait for the target.
      }
      if (nodeId === pendingSourceRef.current) {
        return; // same node re-selected; a connection needs two distinct nodes.
      }
      const connector = connectModeRef.current;
      const model = modelRef.current;
      const source = model.nodes.find(
        (n) => n.elementId === pendingSourceRef.current,
      );
      const target = model.nodes.find((n) => n.elementId === nodeId);
      if (connector === null || source === undefined || target === undefined) {
        cancelConnectMode();
        return;
      }
      const n = edgeCountRef.current;
      edgeCountRef.current = n + 1;
      const edge = buildManualEdge({
        elementId: `edge-${Date.now()}-${n}`,
        connector,
        source,
        target,
      });
      const next = addEdge(model, edge);
      modelRef.current = next;
      cancelConnectMode();
      renderModel(next);
      onModelChange(next);
    },
    [cancelConnectMode, onModelChange, renderModel],
  );

  // Capture an on-canvas point-edit of a connection arrow as the edge's
  // waypoints (DEV-1210). Only a real drag — not merely entering the point
  // editor — locks the route; persists to the model (which the shell holds for
  // Save) without re-rendering, so Excalidraw owns the live geometry.
  const captureWaypointEdit = useCallback(
    (
      elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
    ): void => {
      const editing = appState.editingLinearElement;
      if (editing === null) {
        waypointBaselineRef.current = null;
        return;
      }
      const arrow = elements.find((el) => el.id === editing.elementId);
      if (arrow === undefined || arrow.type !== "arrow") {
        return;
      }
      const edge = modelRef.current.edges.find((e) => e.elementId === arrow.id);
      if (edge === undefined) {
        return; // the element being point-edited isn't one of our connections
      }
      const interior = arrowInteriorWaypoints(arrow.x, arrow.y, arrow.points);
      const baseline = waypointBaselineRef.current;
      const baselineKey =
        baseline !== null && baseline.id === arrow.id ? baseline.key : null;
      const decision = decideWaypointCapture(baselineKey, interior);
      if (decision.kind === "snapshot") {
        waypointBaselineRef.current = { id: arrow.id, key: waypointsKey(interior) };
        return;
      }
      if (decision.kind === "skip") {
        return;
      }
      const waypoints =
        decision.waypoints.length > 0
          ? decision.waypoints.map((p) => ({ x: p.x, y: p.y }))
          : undefined;
      // Pin the bound endpoints too: the reload router only honours waypoints
      // when start/end are present, so a route captured without them would be
      // silently dropped on the next reload for any edge whose ports were not
      // already resolved (e.g. an MCP-proposed connection).
      const ends = arrowEndpoints(arrow.x, arrow.y, arrow.points);
      const nextModel: PlacementModel = {
        ...modelRef.current,
        edges: modelRef.current.edges.map((e) =>
          e.elementId === arrow.id
            ? {
                ...e,
                waypoints,
                ...(ends !== null ? { start: ends.start, end: ends.end } : {}),
              }
            : e,
        ),
      };
      modelRef.current = nextModel;
      waypointBaselineRef.current = { id: arrow.id, key: waypointsKey(interior) };
      onModelChangeRef.current(nextModel);
    },
    [],
  );

  const handleChange = useCallback(
    (_elements: readonly OrderedExcalidrawElement[], appState: AppState) => {
      // While connecting, selections drive endpoint capture, not the attribute
      // panel — suppress normal selection reporting until the connection is made.
      if (connectModeRef.current !== null) {
        handleConnectSelection(
          resolveSelectedNodeId(appState.selectedElementIds),
        );
        return;
      }
      // Capture an in-progress point-edit before reflow, so a now-waypointed edge
      // is skipped by the orthogonal reflow (DEV-1210 / DEV-1204).
      captureWaypointEdit(_elements, appState);
      // Keep connections orthogonal when a node is moved (DEV-1204).
      reflowConnections();
      if (onSelectionChange === undefined) {
        return;
      }
      const selected = resolveSelectedNode(appState.selectedElementIds);
      if (selected !== lastSelectionRef.current) {
        lastSelectionRef.current = selected;
        onSelectionChange(selected);
      }
    },
    [
      captureWaypointEdit,
      handleConnectSelection,
      onSelectionChange,
      reflowConnections,
      resolveSelectedNode,
      resolveSelectedNodeId,
    ],
  );

  // Esc cancels an in-progress connection.
  useEffect(() => {
    if (connectMode === null) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelConnectMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connectMode, cancelConnectMode]);

  // When the server hands a freshly loaded/refreshed model, replace the canvas
  // from canonical state (never merge — server is the single source of truth).
  useEffect(() => {
    modelRef.current = initialModel;
    placeCountRef.current = 0;
    if (apiReady) {
      renderModel(initialModel);
    }
  }, [apiReady, initialModel, renderModel]);

  const handlePlace = useCallback(
    (id: SymbolId) => {
      const api = apiRef.current;
      if (api === null) {
        return;
      }
      // Connectors are edges, not placeable nodes: a connector click enters
      // connect mode (DEV-1194), where the next two equipment clicks become the
      // source and target of a new bound connection.
      if (isConnectorId(id)) {
        enterConnectMode(id);
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
    [enterConnectMode, onModelChange],
  );

  const connectHint =
    connectMode === null
      ? null
      : !sourcePicked
        ? `Connecting (${getSymbol(connectMode).label}) — click the SOURCE equipment.`
        : `Click the TARGET equipment to finish the connection.`;

  return (
    <div className="flex h-full w-full">
      <EquipmentPalette onPlace={handlePlace} />
      <div className="relative flex-1" data-testid="pid-canvas-mount">
        {connectMode !== null ? (
          <div
            data-testid="connect-hint"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-2"
          >
            <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow">
              <span>{connectHint}</span>
              <button
                type="button"
                data-testid="connect-cancel"
                onClick={cancelConnectMode}
                className="rounded bg-blue-500 px-2 py-0.5 text-xs hover:bg-blue-400"
              >
                Cancel (Esc)
              </button>
            </div>
          </div>
        ) : null}
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
            // Defer rendering to the effect above (gated on apiReady) so the
            // scene update lands after Excalidraw finishes initializing.
            setApiReady(true);
          }}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
