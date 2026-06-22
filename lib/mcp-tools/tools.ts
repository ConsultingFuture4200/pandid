/**
 * MCP read tools (DEV-1146, FR-6 / FR-9 / FR-15, PRD §5.2).
 *
 * The four READ-ONLY tools the MCP server (DEV-1145) exposes to Claude Desktop:
 *
 *   - get_active_diagram     → structured diagram state + SVG snapshot
 *   - list_equipment_types   → the available symbol set + required attributes
 *   - validate_active_diagram→ the v1 connectivity validator report (+ SVG)
 *   - export_line_list       → the derived line list (+ SVG)
 *
 * Architecture invariants (CLAUDE.md) — these tools are deliberately read-only:
 *   - One committer. NONE of these mutate canonical state. There is no commit /
 *     stage path here; mutating tools are the separate propose tools (DEV-1150),
 *     which stage validated proposals a human accepts. A read tool that wrote
 *     state would be a bug.
 *   - Server is the single source of truth. Every tool reads the account's active
 *     diagram from the canonical store (via `ActiveDiagramSource`); it never holds
 *     its own copy and never reads the browser canvas.
 *   - Account-scoped. A tool acts on whatever diagram is active for the calling
 *     account (PRD §3) — it never takes a diagram id from Claude. The resolved
 *     `{ accountId, activeDiagramId }` arrives in the `TransportContext`
 *     (DEV-1143 seam); DEV-1149 resolves account → active diagram upstream.
 *
 * Each diagram-state tool returns the server-rendered SVG snapshot alongside its
 * structured payload (FR-9) so Claude — which cannot see the canvas — can verify
 * what the diagram looks like.
 */
import type { TransportContext } from "@/lib/claude-transport";
import { listEquipmentTypes, type EquipmentTypeSummary } from "@/lib/symbols";
import { renderDiagramSvg } from "@/lib/diagram/render-svg";
import type { VersionSnapshot } from "@/lib/diagram";
import type { ElementMetadata } from "@/lib/types";
import {
  createConnectivityValidator,
  type ValidationReport,
  type Validator,
} from "@/lib/validator";
import {
  buildCanonicalState,
  type CanonicalState,
  type ConnectionState,
  type EquipmentState,
  type LineListRow,
} from "./canonical-state";
import {
  McpReadError,
  type ActiveDiagram,
  type ActiveDiagramSource,
} from "./active-diagram-source";
import {
  effectiveSceneFromSnapshot,
  editFromScene,
} from "./scene-edit";
import type { ProposeOp } from "./propose-ops";

/**
 * Supplies the active diagram's PENDING proposal ops (in stage order) so a read
 * tool can project committed + pending state. Optional: a server with no pending
 * overlay (or the read tools used in isolation) projects committed-only.
 */
export interface PendingOpsProvider {
  pendingOps(context: TransportContext): Promise<readonly ProposeOp[]>;
}

/** Sentinel ids for a synthetic snapshot projecting an effective (committed +
 * pending) scene that has no committed version of its own yet. */
const SYNTHETIC_VERSION_ID = "00000000-0000-4000-8000-0000000000ef";
const SYNTHETIC_DIAGRAM_ID = "00000000-0000-4000-8000-0000000000ee";

/** Common envelope: the active diagram a read tool resolved its answer from. */
interface ActiveDiagramRef {
  /** The active diagram's id. */
  readonly diagramId: string;
  /** Its name (orientation for Claude). */
  readonly name: string;
  /** The immutable version id this state was read from, or null if never saved. */
  readonly versionId: string | null;
}

/** Result of `get_active_diagram`: structured state + SVG snapshot (FR-6,9). */
export interface ActiveDiagramResult {
  readonly diagram: ActiveDiagramRef;
  readonly equipment: readonly EquipmentState[];
  readonly connections: readonly ConnectionState[];
  /** Server-rendered SVG of the same state (FR-9). */
  readonly svg: string;
}

/** Result of `list_equipment_types`: the available symbol set (FR-6). */
export interface EquipmentTypesResult {
  readonly equipmentTypes: readonly EquipmentTypeSummary[];
}

/** Result of `validate_active_diagram`: the v1 validator report + SVG. */
export interface ValidateActiveDiagramResult {
  readonly diagram: ActiveDiagramRef;
  readonly report: ValidationReport;
  readonly svg: string;
}

/** Result of `export_line_list`: the derived line list + SVG. */
export interface LineListResult {
  readonly diagram: ActiveDiagramRef;
  readonly lineList: readonly LineListRow[];
  readonly svg: string;
}

/**
 * The read-tool surface. Constructed once per server with the canonical active-
 * diagram source and a validator; each method is a single MCP tool call.
 */
export class McpReadTools {
  private readonly validator: Validator;

  constructor(
    private readonly source: ActiveDiagramSource,
    validator: Validator = createConnectivityValidator(),
    /**
     * Optional pending-op overlay. When supplied, `get_active_diagram` projects
     * committed + PENDING state so Claude can see (and reference the element/port
     * ids of) changes it staged but the human has not yet accepted. The other read
     * tools stay committed-only (they report the validated, saved diagram).
     */
    private readonly pendingOps?: PendingOpsProvider,
  ) {
    this.validator = validator;
  }

  /**
   * `get_active_diagram` — structured state + SVG snapshot of the account's
   * active diagram (FR-6, FR-9). Read-only.
   *
   * @throws {McpReadError} `no-active-diagram` if the account has no active
   *   diagram; `unauthorized` if the diagram is not owned by the account.
   */
  async getActiveDiagram(context: TransportContext): Promise<ActiveDiagramResult> {
    const { ref, state } = await this.loadEffectiveState(context);
    return {
      diagram: ref,
      equipment: state.equipment,
      connections: state.connections,
      svg: renderDiagramSvg(state.renderState),
    };
  }

  /**
   * `list_equipment_types` — the available equipment/connector types and their
   * required attributes (FR-6). Diagram-independent: the palette is the same for
   * every account, so this does not resolve an active diagram.
   */
  listEquipmentTypes(): EquipmentTypesResult {
    return { equipmentTypes: listEquipmentTypes() };
  }

  /**
   * `validate_active_diagram` — run the v1 connectivity validator over the active
   * diagram and return its report plus an SVG snapshot. Read-only: it never
   * commits, it only reports (FR-9). The same validator the commit pipeline uses,
   * so what passes here is what would commit.
   *
   * @throws {McpReadError} as `getActiveDiagram`.
   */
  async validateActiveDiagram(
    context: TransportContext,
  ): Promise<ValidateActiveDiagramResult> {
    const { ref, state } = await this.loadState(context);
    return {
      diagram: ref,
      report: this.validator.validate(state.validatorSnapshot),
      svg: renderDiagramSvg(state.renderState),
    };
  }

  /**
   * `export_line_list` — the line list derived from the active diagram's scene +
   * metadata (FR-15), plus an SVG snapshot. Read-only.
   *
   * @throws {McpReadError} as `getActiveDiagram`.
   */
  async exportLineList(context: TransportContext): Promise<LineListResult> {
    const { ref, state } = await this.loadState(context);
    return {
      diagram: ref,
      lineList: state.lineList,
      svg: renderDiagramSvg(state.renderState),
    };
  }

  /**
   * Resolve the account's active diagram and project its latest version to the
   * read-side canonical state every tool draws from. Centralizing this keeps the
   * account-scoping + single-source-of-truth invariants in one place.
   */
  private async loadState(
    context: TransportContext,
  ): Promise<{ ref: ActiveDiagramRef; state: CanonicalState }> {
    const active = await this.source.getActiveDiagram(context);
    const ref: ActiveDiagramRef = {
      diagramId: active.diagram.id,
      name: active.diagram.name,
      versionId: active.snapshot?.version.id ?? null,
    };
    // No saved version yet → an empty diagram. Project an empty snapshot so the
    // tools answer "empty", not error: a freshly-created diagram is valid input.
    const state =
      active.snapshot === null
        ? EMPTY_STATE
        : buildCanonicalState(active.snapshot);
    return { ref, state };
  }

  /**
   * As {@link loadState}, but overlaying PENDING proposal ops onto committed state
   * when a {@link PendingOpsProvider} is wired. With no provider or no pending ops,
   * this is identical to committed-only `loadState`. The overlay lets Claude see
   * what it staged (with real element/port ids) before the human accepts.
   */
  private async loadEffectiveState(
    context: TransportContext,
  ): Promise<{ ref: ActiveDiagramRef; state: CanonicalState }> {
    if (this.pendingOps === undefined) {
      return this.loadState(context);
    }
    const active = await this.source.getActiveDiagram(context);
    const ref: ActiveDiagramRef = {
      diagramId: active.diagram.id,
      name: active.diagram.name,
      versionId: active.snapshot?.version.id ?? null,
    };
    const ops = await this.pendingOps.pendingOps(context);
    if (ops.length === 0) {
      // No overlay needed — project committed state as-is.
      const state =
        active.snapshot === null
          ? EMPTY_STATE
          : buildCanonicalState(active.snapshot);
      return { ref, state };
    }
    // Build the effective scene (committed + pending) and project it through a
    // synthetic snapshot — the same read-side projection committed state uses, so
    // the shape Claude sees here matches what accept will eventually commit.
    const scene = effectiveSceneFromSnapshot(active, ops);
    const snapshot = effectiveSnapshot(active, scene);
    return { ref, state: buildCanonicalState(snapshot) };
  }
}

/**
 * Build a synthetic {@link VersionSnapshot} that carries an effective scene
 * (committed + pending). The scene JSON comes from `editFromScene` (the `pid`
 * projection the read side reads); metadata rows are synthesized from the edit's
 * elements (the authoritative attribute store the projection joins on). Reuses the
 * committed version's ids where available so the projection's version id is real.
 */
function effectiveSnapshot(
  active: ActiveDiagram,
  scene: Parameters<typeof editFromScene>[0],
): VersionSnapshot {
  const edit = editFromScene(scene);
  const baseVersion = active.snapshot?.version;
  const versionId = baseVersion?.id ?? SYNTHETIC_VERSION_ID;
  const diagramId = baseVersion?.diagramId ?? active.diagram.id ?? SYNTHETIC_DIAGRAM_ID;
  const createdAt = baseVersion?.createdAt ?? "1970-01-01T00:00:00.000Z";
  const metadata: ElementMetadata[] = edit.elements.map((el) => ({
    diagramVersionId: versionId,
    elementId: el.id,
    equipmentType: el.equipmentType,
    attributes: el.attributes,
  }));
  return {
    version: {
      id: versionId,
      diagramId,
      excalidrawScene: edit.scene,
      createdAt,
    },
    metadata,
  };
}

/** The projection of a diagram that has no saved version (nothing placed yet). */
const EMPTY_STATE: CanonicalState = {
  equipment: [],
  connections: [],
  validatorSnapshot: { elements: [], connections: [], metadata: [] },
  renderState: { equipment: [], connections: [], viewport: { width: 800, height: 600 } },
  lineList: [],
};

export { McpReadError };
