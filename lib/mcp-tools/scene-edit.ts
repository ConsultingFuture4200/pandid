/**
 * Scene-edit engine for the MCP propose tools (DEV-1150).
 *
 * A propose tool describes an INCREMENTAL change (add one element, connect two
 * ports, …), but the commit pipeline and proposal lifecycle consume a WHOLE-scene
 * {@link DiagramEdit} (CLAUDE.md: one committer, one shape). This module bridges
 * the two: it loads the account's active diagram into a mutable {@link
 * EditableScene}, applies an op as a PURE transform, and re-derives the full
 * `DiagramEdit` — the very edit the manual canvas would commit, so both paths
 * share one validator and one persist path.
 *
 * The editable model mirrors the read-side `pid` projection
 * (`canonical-state.ts`): placements (geometry + ports), connection edges, and
 * element metadata (the authoritative tag/attribute store, keyed by element id).
 * Serialization writes the scene back under the `pid` key the read tools read, so
 * what Claude is shown after staging matches `get_active_diagram` after accept.
 *
 * Purity: every `applyOp` returns a new scene; the input is never mutated. No
 * I/O, no Excalidraw runtime — deterministic, so the staged SVG is golden-stable.
 */
import { getSymbol, isSymbolId, type SymbolId } from "@/lib/symbols";
import type { JsonObject } from "@/lib/types";
import type { CommitElement, DiagramEdit } from "@/lib/diagram/commit";
import { pidSceneSchema } from "./canonical-state";
import type { ActiveDiagram } from "./active-diagram-source";
import { McpProposeError } from "./propose-error";
import type {
  AddEquipmentArgs,
  ConnectArgs,
  DeleteElementArgs,
  MoveOrRelabelArgs,
  ProposeOp,
  SetMetadataArgs,
} from "./propose-ops";

/** Default on-canvas footprint (px) for a newly placed equipment symbol. */
const DEFAULT_SIZE = 100;
/** Fallback viewport when the scene declares none. */
const DEFAULT_VIEWPORT = { width: 800, height: 600 } as const;
/** Implicit identity attribute key for equipment (mirrors the validator). */
const TAG_KEY = "tag";
/** Implicit identity attribute key for a connector line. */
const LINE_ID_KEY = "lineId";

/** A placed element in the editable scene: geometry + the ports it exposes. */
interface ScenePlacement {
  elementId: string;
  symbolId: SymbolId;
  x: number;
  y: number;
  size: number;
  portIds: string[];
}

/** A connection edge in the editable scene. Endpoint geometry is resolved from
 * the bound ports so the staged SVG draws the new line. */
interface SceneConnection {
  elementId: string;
  sourceElementId: string | null;
  targetElementId: string | null;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  signal: boolean;
}

/** The full editable scene a propose op transforms. */
export interface EditableScene {
  placements: ScenePlacement[];
  connections: SceneConnection[];
  /** Authoritative element metadata keyed by element id (tag + attributes). */
  metadata: Map<string, { equipmentType: SymbolId; attributes: JsonObject }>;
  viewport: { width: number; height: number };
}

export type { ProposeOp } from "./propose-ops";

/**
 * Build an editable scene from the account's active diagram. Geometry + edges
 * come from the persisted scene's `pid` projection; metadata (authoritative
 * tags/attributes) from the parallel store. An empty diagram (no version) yields
 * an empty scene — a valid base to add the first element onto.
 */
export function sceneFromSnapshot(active: ActiveDiagram): EditableScene {
  const snapshot = active.snapshot;
  if (snapshot === null) {
    return {
      placements: [],
      connections: [],
      metadata: new Map(),
      viewport: { ...DEFAULT_VIEWPORT },
    };
  }

  const parsed = pidSceneSchema.safeParse(snapshot.version.excalidrawScene);
  const pid = parsed.success ? parsed.data.pid : undefined;

  const placements: ScenePlacement[] = (pid?.placements ?? []).flatMap((p) =>
    isSymbolId(p.symbolId)
      ? [
          {
            elementId: p.elementId,
            symbolId: p.symbolId,
            x: p.x,
            y: p.y,
            size: p.size ?? DEFAULT_SIZE,
            portIds: [...p.portIds],
          },
        ]
      : [],
  );

  const connections: SceneConnection[] = (pid?.connections ?? []).map((c) => ({
    elementId: c.elementId,
    sourceElementId: c.sourceElementId,
    targetElementId: c.targetElementId,
    start: c.start,
    end: c.end,
    signal: c.signal,
  }));

  const metadata = new Map<
    string,
    { equipmentType: SymbolId; attributes: JsonObject }
  >();
  for (const m of snapshot.metadata) {
    if (isSymbolId(m.equipmentType)) {
      metadata.set(m.elementId, {
        equipmentType: m.equipmentType,
        attributes: { ...m.attributes },
      });
    }
  }

  return {
    placements,
    connections,
    metadata,
    viewport: pid?.viewport ?? { ...DEFAULT_VIEWPORT },
  };
}

/**
 * Build the EFFECTIVE editable scene: committed state with every PENDING
 * proposal's op applied in stage order. This is the base a NEW op stages against
 * (so a `connect` can reference just-added-but-uncommitted equipment) AND the
 * scene `get_active_diagram` projects (so Claude sees committed + pending and can
 * name staged element/port ids).
 *
 * `pendingOps` must be in STAGE ORDER (oldest first) — the order the proposals
 * were created — so the reconstructed scene matches what each successive stage saw.
 * A pending op that no longer applies cleanly to the committed base (e.g. its
 * target was rejected/never committed) throws `McpProposeError` from `applyOp`;
 * since these are previously-validated ops over a forward-moving committed base,
 * that is not expected in normal operation.
 */
export function effectiveSceneFromSnapshot(
  active: ActiveDiagram,
  pendingOps: readonly ProposeOp[],
): EditableScene {
  let scene = sceneFromSnapshot(active);
  for (const op of pendingOps) {
    scene = applyOp(scene, op);
  }
  return scene;
}

/**
 * Serialize an editable scene to the whole-scene {@link DiagramEdit} the commit
 * pipeline / proposal lifecycle consume. The scene is written under the `pid`
 * key the read tools project from; elements carry the metadata store; connections
 * are the derived edges. Connector elements (no placement) are emitted as
 * elements too so their metadata (line id) persists and the line-list resolves.
 */
export function editFromScene(scene: EditableScene): DiagramEdit {
  const sceneJson: JsonObject = {
    pid: {
      placements: scene.placements.map((p) => ({
        elementId: p.elementId,
        symbolId: p.symbolId,
        x: p.x,
        y: p.y,
        size: p.size,
        portIds: [...p.portIds],
      })),
      connections: scene.connections.map((c) => ({
        elementId: c.elementId,
        sourceElementId: c.sourceElementId,
        targetElementId: c.targetElementId,
        ...(c.start !== undefined ? { start: c.start } : {}),
        ...(c.end !== undefined ? { end: c.end } : {}),
        signal: c.signal,
      })),
      viewport: scene.viewport,
    },
  };

  const elements: CommitElement[] = [];
  // Equipment elements (placements), in scene order.
  for (const p of scene.placements) {
    elements.push({
      id: p.elementId,
      equipmentType: p.symbolId,
      portIds: [...p.portIds],
      attributes: scene.metadata.get(p.elementId)?.attributes ?? {},
    });
  }
  // Connector elements carry no ports of their own; their type defaults to a
  // process/signal line so the metadata + line-list resolve.
  for (const c of scene.connections) {
    const meta = scene.metadata.get(c.elementId);
    const equipmentType: SymbolId =
      meta?.equipmentType ?? (c.signal ? "signal-line" : "process-line");
    elements.push({
      id: c.elementId,
      equipmentType,
      portIds: [],
      attributes: meta?.attributes ?? {},
    });
  }

  return {
    scene: sceneJson,
    elements,
    connections: scene.connections.map((c) => ({
      elementId: c.elementId,
      sourceElementId: c.sourceElementId,
      targetElementId: c.targetElementId,
    })),
  };
}

/** Apply a propose op as a pure transform, returning a new scene. The input is
 * never mutated (sceneFromSnapshot already produced a fresh, owned model, but we
 * keep each op total and side-effect-free for clarity). */
export function applyOp(scene: EditableScene, op: ProposeOp): EditableScene {
  switch (op.kind) {
    case "add-equipment":
      return addEquipment(scene, op.args);
    case "connect":
      return connect(scene, op.args);
    case "set-metadata":
      return setMetadata(scene, op.args);
    case "delete-element":
      return deleteElement(scene, op.args);
    case "move-or-relabel":
      return moveOrRelabel(scene, op.args);
  }
}

function addEquipment(scene: EditableScene, args: AddEquipmentArgs): EditableScene {
  // Guarded by the tool, but re-narrow so this stays total without `any`.
  if (!isSymbolId(args.equipmentType)) {
    throw new McpProposeError(
      "invalid-args",
      `Unknown equipment type "${args.equipmentType}".`,
    );
  }
  const symbol = getSymbol(args.equipmentType);
  // Prefer the id the tool assigned at stage time so the op is a deterministic
  // delta (re-applying it yields the same id); mint one only for a hand-built op.
  const elementId = args.elementId ?? newElementId("eq");
  const placement: ScenePlacement = {
    elementId,
    symbolId: args.equipmentType,
    x: args.x,
    y: args.y,
    size: args.size ?? DEFAULT_SIZE,
    portIds: symbol.ports.map((p) => p.id),
  };
  const attributes: JsonObject = { ...(args.attributes ?? {}) };
  const next = clone(scene);
  next.placements.push(placement);
  next.metadata.set(elementId, {
    equipmentType: args.equipmentType,
    attributes,
  });
  return next;
}

function connect(scene: EditableScene, args: ConnectArgs): EditableScene {
  // Endpoint existence/port validity is the VALIDATOR's job (FR-8) — we do not
  // pre-reject here; we build the edge (resolving geometry where we can) and let
  // staging refuse an invalid binding with a structured report. We still resolve
  // geometry only for ports that exist, so a valid edge draws and an invalid one
  // still stages → gets refused with `endpoint-missing-port`/`-element`.
  const elementId = args.elementId ?? newElementId(args.signal ? "sig" : "line");
  const start = portPoint(scene, args.sourceElementId, args.sourcePort);
  const end = portPoint(scene, args.targetElementId, args.targetPort);
  const connection: SceneConnection = {
    elementId,
    sourceElementId: args.sourceElementId,
    targetElementId: args.targetElementId,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    signal: args.signal ?? false,
  };
  const next = clone(scene);
  next.connections.push(connection);
  // Attach connector metadata when a line id and/or other attributes (e.g. a
  // process line's required `service`) were provided. A connector with no
  // metadata still stages — and is refused (FR-8) if its type requires an
  // attribute it lacks — so the caller learns what to supply.
  const connectorAttributes: JsonObject = {
    ...(args.attributes ?? {}),
    ...(args.lineId !== undefined ? { [LINE_ID_KEY]: args.lineId } : {}),
  };
  if (Object.keys(connectorAttributes).length > 0) {
    next.metadata.set(elementId, {
      equipmentType: args.signal ? "signal-line" : "process-line",
      attributes: connectorAttributes,
    });
  }
  return next;
}

function setMetadata(scene: EditableScene, args: SetMetadataArgs): EditableScene {
  const existing = requireElement(scene, args.elementId);
  const next = clone(scene);
  // Merge (not replace): keep existing keys, override with provided ones.
  next.metadata.set(args.elementId, {
    equipmentType: existing.equipmentType,
    attributes: { ...existing.attributes, ...args.attributes },
  });
  return next;
}

function deleteElement(scene: EditableScene, args: DeleteElementArgs): EditableScene {
  requireElementPresence(scene, args.elementId);
  const next = clone(scene);
  next.placements = next.placements.filter((p) => p.elementId !== args.elementId);
  // Drop the element itself if it is a connection, AND any edges incident on it
  // (so deleting equipment never leaves a dangling/orphan arrow — which the
  // validator would otherwise reject).
  next.connections = next.connections.filter(
    (c) =>
      c.elementId !== args.elementId &&
      c.sourceElementId !== args.elementId &&
      c.targetElementId !== args.elementId,
  );
  next.metadata.delete(args.elementId);
  return next;
}

function moveOrRelabel(
  scene: EditableScene,
  args: MoveOrRelabelArgs,
): EditableScene {
  requireElementPresence(scene, args.elementId);
  const next = clone(scene);

  if (args.x !== undefined || args.y !== undefined) {
    const placement = next.placements.find((p) => p.elementId === args.elementId);
    if (placement === undefined) {
      throw new McpProposeError(
        "element-not-found",
        `Element "${args.elementId}" is not a placed element and can't be moved. ` +
          "Only equipment symbols have a position.",
      );
    }
    if (args.x !== undefined) placement.x = args.x;
    if (args.y !== undefined) placement.y = args.y;
    // Re-resolve geometry of edges incident on the moved element so the SVG stays
    // accurate after the move.
    reanchorIncidentEdges(next, args.elementId);
  }

  if (args.tag !== undefined) {
    const meta = next.metadata.get(args.elementId) ?? {
      equipmentType: inferType(next, args.elementId),
      attributes: {},
    };
    next.metadata.set(args.elementId, {
      equipmentType: meta.equipmentType,
      attributes: { ...meta.attributes, [TAG_KEY]: args.tag },
    });
  }

  return next;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Deep-enough clone: arrays/maps are copied; placements/connections are spread
 * so a mutation in one op does not leak to the input scene. */
function clone(scene: EditableScene): EditableScene {
  return {
    placements: scene.placements.map((p) => ({ ...p, portIds: [...p.portIds] })),
    connections: scene.connections.map((c) => ({ ...c })),
    metadata: new Map(
      [...scene.metadata].map(([k, v]) => [
        k,
        { equipmentType: v.equipmentType, attributes: { ...v.attributes } },
      ]),
    ),
    viewport: { ...scene.viewport },
  };
}

/** Require an element exists somewhere in the scene (placement, connection, or
 * metadata); throw a typed boundary error otherwise. */
function requireElementPresence(scene: EditableScene, elementId: string): void {
  const present =
    scene.placements.some((p) => p.elementId === elementId) ||
    scene.connections.some((c) => c.elementId === elementId) ||
    scene.metadata.has(elementId);
  if (!present) {
    throw new McpProposeError(
      "element-not-found",
      `Element "${elementId}" is not in the active diagram. Call ` +
        "get_active_diagram to see the current element ids, then retry.",
    );
  }
}

/** As {@link requireElementPresence}, returning the element's metadata entry,
 * synthesizing one for a known placement that has no metadata row yet. */
function requireElement(
  scene: EditableScene,
  elementId: string,
): { equipmentType: SymbolId; attributes: JsonObject } {
  const meta = scene.metadata.get(elementId);
  if (meta !== undefined) {
    return meta;
  }
  const placement = scene.placements.find((p) => p.elementId === elementId);
  if (placement !== undefined) {
    return { equipmentType: placement.symbolId, attributes: {} };
  }
  throw new McpProposeError(
    "element-not-found",
    `Element "${elementId}" is not in the active diagram. Call ` +
      "get_active_diagram to see the current element ids, then retry.",
  );
}

/** The element's equipment type from a placement or its metadata; defaults to a
 * process line for a bare connection element. */
function inferType(scene: EditableScene, elementId: string): SymbolId {
  const placement = scene.placements.find((p) => p.elementId === elementId);
  if (placement !== undefined) return placement.symbolId;
  const connection = scene.connections.find((c) => c.elementId === elementId);
  if (connection !== undefined) {
    return connection.signal ? "signal-line" : "process-line";
  }
  return scene.metadata.get(elementId)?.equipmentType ?? "process-line";
}

/** Resolve a port's absolute point from an element's placement + the symbol's
 * local port geometry, or undefined when the element/port can't be resolved (an
 * invalid binding the validator will reject). */
function portPoint(
  scene: EditableScene,
  elementId: string,
  portId: string,
): { x: number; y: number } | undefined {
  const placement = scene.placements.find((p) => p.elementId === elementId);
  if (placement === undefined) return undefined;
  const port = getSymbol(placement.symbolId).ports.find((p) => p.id === portId);
  if (port === undefined) return undefined;
  return {
    x: placement.x + (port.x / 100) * placement.size,
    y: placement.y + (port.y / 100) * placement.size,
  };
}

/** Recompute the resolved endpoint geometry of any edge incident on `elementId`
 * after that element moved, so the staged SVG draws lines from the new position. */
function reanchorIncidentEdges(scene: EditableScene, elementId: string): void {
  const placement = scene.placements.find((p) => p.elementId === elementId);
  if (placement === undefined) return;
  // Best-effort: snap the incident endpoint to the moved element's centre.
  // Geometry only — never affects validation (which keys on element/port, not xy).
  const centre = {
    x: placement.x + placement.size / 2,
    y: placement.y + placement.size / 2,
  };
  for (const c of scene.connections) {
    if (c.sourceElementId === elementId && c.start !== undefined) {
      c.start = { ...centre };
    }
    if (c.targetElementId === elementId && c.end !== undefined) {
      c.end = { ...centre };
    }
  }
}

/** Monotonic-ish unique element id for a newly created element. Deterministic
 * enough for staging; collisions across a single op are impossible (one new id
 * per op). */
let counter = 0;
function newElementId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
