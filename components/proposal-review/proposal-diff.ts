/**
 * Proposal diff — what a pending proposal would ADD to canonical state
 * (DEV-1153, PRD §5.2 step 6, FR-10).
 *
 * The pending-proposal canvas UI must show a staged proposal "visually distinct"
 * from committed elements (FR-10). To do that deterministically — and to render a
 * golden-stable preview — we compute the set difference between the proposal's
 * staged next-state and the diagram's current committed state: which equipment
 * placements and which connection edges are NEW in the proposal.
 *
 * The proposal's `staged_change` carries the WHOLE next-scene edit (one committer,
 * one shape — see lib/mcp-tools/scene-edit.ts), the very `DiagramEdit` the accept
 * path re-validates and commits. Its scene is written under the `pid` projection
 * key the read tools project from, so this module reads that same projection from
 * BOTH the committed state and the staged change and diffs by element id.
 *
 * Why diff at all (rather than render the whole staged scene ghosted): the canvas
 * already shows the committed diagram; the proposal overlay should highlight only
 * what Claude is proposing to add, so the human sees the delta at a glance. New
 * elements render ghosted (overlay); unchanged committed elements render normally.
 *
 * Pure + deterministic: state in, diff out. No I/O, no Excalidraw runtime — so the
 * overlay it feeds is golden-stable (🟡).
 */
import { isSymbolId, type SymbolId } from "@/lib/symbols";
import type { JsonObject, JsonValue } from "@/lib/types";
import { pidSceneSchema } from "@/lib/mcp-tools/canonical-state";

/** Default on-canvas footprint (px) when a placement gives no explicit size. */
const DEFAULT_PLACEMENT_SIZE = 100;
/** Fallback viewport when neither committed nor staged scene declares one. */
const DEFAULT_VIEWPORT = { width: 800, height: 600 } as const;
/** Implicit identity attribute key for equipment (mirrors the validator). */
const TAG_KEY = "tag";

/** A placed equipment element in the proposal preview. */
export interface ProposalEquipment {
  /** Excalidraw element id — the join key across scene + metadata. */
  readonly elementId: string;
  readonly symbolId: SymbolId;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** Equipment tag from the staged metadata, if any. */
  readonly tag?: string;
}

/** A connection edge in the proposal preview, reduced to drawable endpoints. */
export interface ProposalConnection {
  readonly elementId: string;
  readonly start: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  /** Signal (dashed) vs process (solid). */
  readonly signal: boolean;
}

/**
 * The diff a pending proposal represents: the full staged scene split into the
 * elements that already exist in committed state ("committed") and the ones the
 * proposal would add ("proposed"). The overlay renderer draws committed normally
 * and proposed ghosted.
 */
export interface ProposalDiff {
  /** Equipment present in committed state (drawn normally). */
  readonly committedEquipment: readonly ProposalEquipment[];
  /** Equipment the proposal would ADD (drawn ghosted). */
  readonly proposedEquipment: readonly ProposalEquipment[];
  /** Connections present in committed state (drawn normally). */
  readonly committedConnections: readonly ProposalConnection[];
  /** Connections the proposal would ADD (drawn ghosted). */
  readonly proposedConnections: readonly ProposalConnection[];
  /** SVG viewport for the preview. */
  readonly viewport: { readonly width: number; readonly height: number };
}

/** A non-empty trimmed string, else undefined. */
function tagOrUndefined(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

/**
 * The minimal scene shape this diff reads. Both the committed version's scene and
 * the staged change's edit scene carry the `pid` projection under the same key, so
 * one parser serves both. Element metadata (tags) for the staged side is supplied
 * separately (it lives in the edit's `elements`, not the `pid` projection).
 */
interface ProjectedScene {
  equipment: ProposalEquipment[];
  connections: ProposalConnection[];
  viewport: { width: number; height: number };
}

/**
 * Project a `pid`-bearing scene into drawable equipment + connections. Tags are
 * resolved from the provided metadata map (element id → attributes). Unknown
 * symbol ids and edges with no resolved endpoint geometry are dropped (they are
 * not drawable), mirroring the canonical-state read projection.
 */
function projectScene(
  scene: JsonObject,
  tagByElementId: ReadonlyMap<string, string>,
): ProjectedScene {
  const parsed = pidSceneSchema.safeParse(scene);
  const pid = parsed.success ? parsed.data.pid : undefined;

  const equipment: ProposalEquipment[] = (pid?.placements ?? []).flatMap((p) => {
    if (!isSymbolId(p.symbolId)) {
      return [];
    }
    const tag = tagByElementId.get(p.elementId);
    return [
      {
        elementId: p.elementId,
        symbolId: p.symbolId,
        x: p.x,
        y: p.y,
        size: p.size ?? DEFAULT_PLACEMENT_SIZE,
        ...(tag !== undefined ? { tag } : {}),
      },
    ];
  });

  const connections: ProposalConnection[] = (pid?.connections ?? []).flatMap((c) =>
    c.start !== undefined && c.end !== undefined
      ? [
          {
            elementId: c.elementId,
            start: c.start,
            end: c.end,
            signal: c.signal,
          },
        ]
      : [],
  );

  return {
    equipment,
    connections,
    viewport: pid?.viewport ?? { ...DEFAULT_VIEWPORT },
  };
}

/** Build an element-id → tag map from a list of edit elements (staged side). */
function tagMapFromElements(
  elements: readonly { id: string; attributes: JsonObject }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of elements) {
    const tag = tagOrUndefined(el.attributes[TAG_KEY]);
    if (tag !== undefined) {
      map.set(el.id, tag);
    }
  }
  return map;
}

/** The committed canonical state this diff compares against: the same `pid`-bearing
 * scene the canvas committed, plus the element tags from the metadata store. */
export interface CommittedSceneInput {
  readonly scene: JsonObject;
  /** Element id → tag, from the parallel metadata store. */
  readonly tagByElementId: ReadonlyMap<string, string>;
}

/** The staged change a pending proposal carries: `{ edit: DiagramEdit }`. The edit
 * scene is `pid`-bearing; element tags come from the edit's `elements`. */
export interface StagedChangeInput {
  readonly scene: JsonObject;
  readonly elements: readonly { id: string; attributes: JsonObject }[];
}

/**
 * Diff a pending proposal against committed state. Elements (by id) present in the
 * staged scene but NOT in the committed scene are "proposed"; the rest are
 * "committed". The proposed set is what the overlay ghosts.
 */
export function diffProposal(
  committed: CommittedSceneInput,
  staged: StagedChangeInput,
): ProposalDiff {
  const committedScene = projectScene(committed.scene, committed.tagByElementId);
  const stagedScene = projectScene(
    staged.scene,
    tagMapFromElements(staged.elements),
  );

  const committedEquipmentIds = new Set(
    committedScene.equipment.map((e) => e.elementId),
  );
  const committedConnectionIds = new Set(
    committedScene.connections.map((c) => c.elementId),
  );

  const proposedEquipment = stagedScene.equipment.filter(
    (e) => !committedEquipmentIds.has(e.elementId),
  );
  const proposedConnections = stagedScene.connections.filter(
    (c) => !committedConnectionIds.has(c.elementId),
  );

  return {
    committedEquipment: committedScene.equipment,
    proposedEquipment,
    committedConnections: committedScene.connections,
    proposedConnections,
    // Prefer the staged viewport (the proposal may extend the canvas); fall back
    // to committed, then default.
    viewport: stagedScene.viewport,
  };
}
