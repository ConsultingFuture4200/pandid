/**
 * Read-side canonical-state projection for the MCP read tools (DEV-1146, FR-6,9).
 *
 * The MCP read tools (PRD §5.2) must hand Claude the account's active diagram as
 * BOTH structured state and a server-rendered SVG snapshot. Claude cannot see the
 * browser canvas, so this projection is built ON THE SERVER from the single
 * source of truth — a persisted, immutable `VersionSnapshot` (canonical scene +
 * the parallel element-metadata store) — never from the live canvas.
 *
 * Why a dedicated read-side schema:
 *   - The persisted `excalidrawScene` is opaque JSON everywhere in the app
 *     (`lib/types/diagram.ts`): lower layers deliberately do not couple to the
 *     Excalidraw element shape. For a READ tool to return placements + edges we
 *     need a stable, boundary-validated structural view of that scene. The canvas
 *     persists that view under a `pid` projection key; this module is the only
 *     reader of it, validated with Zod at the boundary (CLAUDE.md: Zod at all
 *     boundaries) and degrading to an empty diagram when absent/malformed rather
 *     than throwing — a brand-new diagram with no saved version is "empty", not
 *     an error.
 *   - The AUTHORITATIVE equipment list (tag + attributes) comes from the parallel
 *     metadata store, NOT from scene `customData` (CLAUDE.md fact #1, which is
 *     dropped on conversion). The scene projection contributes only geometry
 *     (placement + ports) and the connection edges.
 *
 * This is a pure projection: snapshot in, structured views out. No I/O, no
 * Excalidraw runtime, deterministic — so the SVG it feeds is golden-stable.
 */
import { z } from "zod";
import { isSymbolId, type SymbolId } from "@/lib/symbols";
import type { JsonObject, JsonValue } from "@/lib/types";
import type { DiagramSnapshot } from "@/lib/validator";
import type { DiagramRenderState } from "@/lib/diagram/render-svg";
import type { VersionSnapshot } from "@/lib/diagram";

/** Default on-canvas footprint (px) when a placement gives no explicit size. */
const DEFAULT_PLACEMENT_SIZE = 100;
/** Fallback SVG viewport when the scene declares none. */
const DEFAULT_VIEWPORT = { width: 800, height: 600 } as const;
/** The implicit identity attribute key for equipment (mirrors the validator). */
const TAG_KEY = "tag";
/** The implicit identity attribute key for a connector line. */
const LINE_ID_KEY = "lineId";

/**
 * One placed element in the read-side scene projection: which symbol it is, where
 * it sits, and the bind-point ids connectors may attach to. Geometry only — the
 * tag/attributes come from the metadata store, joined by `elementId`.
 */
const pidPlacementSchema = z.object({
  elementId: z.string().min(1),
  symbolId: z.string().min(1),
  x: z.number(),
  y: z.number(),
  size: z.number().positive().optional(),
  portIds: z.array(z.string().min(1)).default([]),
});

/** One connection edge in the read-side scene projection. */
const pidConnectionSchema = z.object({
  elementId: z.string().min(1),
  sourceElementId: z.string().min(1).nullable(),
  targetElementId: z.string().min(1).nullable(),
  /** Resolved start point (source port), if the canvas computed one. */
  start: z.object({ x: z.number(), y: z.number() }).optional(),
  /** Resolved end point (target port), if the canvas computed one. */
  end: z.object({ x: z.number(), y: z.number() }).optional(),
  /** Signal (dashed) vs process (solid) line. Defaults to process. */
  signal: z.boolean().default(false),
});

/**
 * The structural view of a persisted scene this read layer consumes, carried on
 * the canonical scene under the `pid` key. Optional so a scene without it (or an
 * empty diagram) projects cleanly to "no equipment, no connections".
 */
export const pidSceneSchema = z.object({
  pid: z
    .object({
      placements: z.array(pidPlacementSchema).default([]),
      connections: z.array(pidConnectionSchema).default([]),
      viewport: z
        .object({ width: z.number().positive(), height: z.number().positive() })
        .optional(),
    })
    .optional(),
});

type PidPlacement = z.infer<typeof pidPlacementSchema>;
type PidConnection = z.infer<typeof pidConnectionSchema>;

/** A piece of equipment in the structured state returned to Claude (FR-6). */
export interface EquipmentState {
  /** Excalidraw element id — the join key across scene + metadata. */
  readonly elementId: string;
  /** Equipment/connector type (a known symbol id). */
  readonly equipmentType: SymbolId;
  /** Equipment tag from the metadata store, if set. */
  readonly tag: string | null;
  /** Full element attributes from the metadata store. */
  readonly attributes: JsonObject;
}

/** A connection in the structured state returned to Claude (FR-6). */
export interface ConnectionState {
  readonly elementId: string;
  readonly sourceElementId: string | null;
  readonly targetElementId: string | null;
  readonly signal: boolean;
}

/** One line-list row derived from scene + metadata (FR-15 read surface). */
export interface LineListRow {
  readonly elementId: string;
  readonly lineId: string | null;
  readonly fromElementId: string | null;
  readonly fromTag: string | null;
  readonly toElementId: string | null;
  readonly toTag: string | null;
  readonly signal: boolean;
}

/**
 * The full read-side projection of canonical state: the structured views every
 * read tool draws from. Built once per tool call from a `VersionSnapshot`.
 */
export interface CanonicalState {
  /** Structured equipment list (FR-6). */
  readonly equipment: readonly EquipmentState[];
  /** Structured connection list (FR-6). */
  readonly connections: readonly ConnectionState[];
  /** The validator's source-agnostic snapshot (for `validate_active_diagram`). */
  readonly validatorSnapshot: DiagramSnapshot;
  /** The renderer's drawable state (for the SVG snapshot, FR-9). */
  readonly renderState: DiagramRenderState;
  /** Derived line-list rows (for `export_line_list`, FR-15). */
  readonly lineList: readonly LineListRow[];
}

/** A non-empty string, else null. Blank/whitespace counts as absent. */
function stringOrNull(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/** Resolve a known SymbolId or null (an unknown type is skipped, not thrown —
 * this is a read projection of already-persisted state, not a commit gate). */
function asSymbolId(value: string): SymbolId | null {
  return isSymbolId(value) ? value : null;
}

/**
 * Parse the read-side structural projection off a canonical scene. Validated at
 * the boundary; on absence or malformed shape returns empty lists (an empty or
 * legacy diagram is "no equipment", not an error).
 */
function projectScene(scene: JsonObject): {
  placements: PidPlacement[];
  connections: PidConnection[];
  viewport: { width: number; height: number };
} {
  const parsed = pidSceneSchema.safeParse(scene);
  const pid = parsed.success ? parsed.data.pid : undefined;
  return {
    placements: pid?.placements ?? [],
    connections: pid?.connections ?? [],
    viewport: pid?.viewport ?? DEFAULT_VIEWPORT,
  };
}

/**
 * Build the read-side canonical state from a persisted version snapshot.
 *
 * Equipment identity/attributes come from the metadata rows (authoritative);
 * geometry and edges come from the scene projection. Placements whose symbol id
 * is unknown are dropped from the render/validator views (a read tool never
 * fabricates an element type the symbol library does not know).
 */
export function buildCanonicalState(snapshot: VersionSnapshot): CanonicalState {
  const { placements, connections, viewport } = projectScene(
    snapshot.version.excalidrawScene,
  );

  // Metadata is the authoritative equipment store, keyed by element id.
  const metaById = new Map(
    snapshot.metadata.map((m) => [m.elementId, m] as const),
  );

  // Placement geometry by id, narrowed to known symbols, preserving scene order.
  const placedKnown: { placement: PidPlacement; symbolId: SymbolId }[] = [];
  const placementById = new Map<
    string,
    { placement: PidPlacement; symbolId: SymbolId }
  >();
  for (const placement of placements) {
    const symbolId = asSymbolId(placement.symbolId);
    if (symbolId === null) {
      continue;
    }
    const entry = { placement, symbolId };
    placedKnown.push(entry);
    placementById.set(placement.elementId, entry);
  }

  // Structured equipment: one row per known-symbol placement, joined to metadata.
  const equipment: EquipmentState[] = placedKnown.map(({ placement, symbolId }) => {
    const attributes = metaById.get(placement.elementId)?.attributes ?? {};
    return {
      elementId: placement.elementId,
      equipmentType: symbolId,
      tag: stringOrNull(attributes[TAG_KEY]),
      attributes,
    };
  });

  const connectionState: ConnectionState[] = connections.map((c) => ({
    elementId: c.elementId,
    sourceElementId: c.sourceElementId,
    targetElementId: c.targetElementId,
    signal: c.signal,
  }));

  // Validator snapshot: elements (id/type/ports) + connections + metadata.
  const validatorSnapshot: DiagramSnapshot = {
    elements: equipment.map((eq) => ({
      id: eq.elementId,
      equipmentType: eq.equipmentType,
      portIds: placementById.get(eq.elementId)?.placement.portIds ?? [],
    })),
    connections: connectionState.map((c) => ({
      elementId: c.elementId,
      sourceElementId: c.sourceElementId,
      targetElementId: c.targetElementId,
    })),
    metadata: equipment.map((eq) => ({
      diagramVersionId: snapshot.version.id,
      elementId: eq.elementId,
      equipmentType: eq.equipmentType,
      attributes: eq.attributes,
    })),
  };

  // Render state: equipment bodies + drawable edges. An edge with no resolved
  // endpoint geometry (a dangling/in-progress arrow) is omitted from the SVG.
  const renderState: DiagramRenderState = {
    equipment: equipment.map((eq) => {
      const placement = placementById.get(eq.elementId)?.placement;
      return {
        elementId: eq.elementId,
        symbolId: eq.equipmentType,
        x: placement?.x ?? 0,
        y: placement?.y ?? 0,
        size: placement?.size ?? DEFAULT_PLACEMENT_SIZE,
        tag: eq.tag ?? undefined,
      };
    }),
    connections: connections.flatMap((c) =>
      c.start !== undefined && c.end !== undefined
        ? [
            {
              elementId: c.elementId,
              start: c.start,
              end: c.end,
              dashed: c.signal,
              // Carry the endpoints so the renderer can route orthogonally against
              // the joined equipment's body faces (matching the canvas).
              sourceElementId: c.sourceElementId ?? undefined,
              targetElementId: c.targetElementId ?? undefined,
            },
          ]
        : [],
    ),
    viewport,
  };

  // Line-list: one row per connection, resolving endpoint tags from metadata.
  const lineList: LineListRow[] = connections.map((c) => ({
    elementId: c.elementId,
    lineId: stringOrNull(metaById.get(c.elementId)?.attributes[LINE_ID_KEY]),
    fromElementId: c.sourceElementId,
    fromTag: c.sourceElementId
      ? stringOrNull(metaById.get(c.sourceElementId)?.attributes[TAG_KEY])
      : null,
    toElementId: c.targetElementId,
    toTag: c.targetElementId
      ? stringOrNull(metaById.get(c.targetElementId)?.attributes[TAG_KEY])
      : null,
    signal: c.signal,
  }));

  return {
    equipment,
    connections: connectionState,
    validatorSnapshot,
    renderState,
    lineList,
  };
}
