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
  type ActiveDiagramSource,
} from "./active-diagram-source";

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
    const { ref, state } = await this.loadState(context);
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
