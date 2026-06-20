/**
 * MCP propose tools (DEV-1150, PRD §5.2, FR-7,8).
 *
 * The five MUTATING tools the MCP server exposes to Claude Desktop:
 *
 *   - add_equipment    → place a new equipment symbol (+ its metadata)
 *   - connect          → bind a new connector between two element ports
 *   - set_metadata     → merge attributes onto an existing element
 *   - delete_element   → remove an element (and any incident connections)
 *   - move_or_relabel  → reposition an element and/or change its tag
 *
 * Architecture invariants (CLAUDE.md) — these tools NEVER commit:
 *   - One committer. Each tool STAGES a validated `Proposal` via the proposal
 *     lifecycle (DEV-1144); only a human accepting in the browser commits, and
 *     that re-validates through the single commit pipeline. There is no persist
 *     path here — a tool that wrote a version would be a bug.
 *   - Proposals are staged, never applied. A tool builds the *next* full diagram
 *     edit from current canonical state + the requested op, then hands it to
 *     `ProposalService.stage`. Staging validates (FR-8): an invalid edit is
 *     REFUSED — no row written, canonical state untouched — and the validator
 *     report is returned to Claude as a `rejected` result, not thrown.
 *   - Server is the single source of truth. The current state is read from the
 *     account's active diagram (the persisted, immutable latest version) via the
 *     shared `ActiveDiagramSource`, never from the browser canvas.
 *   - Account-scoped. A tool acts on whatever diagram is active for the calling
 *     account (PRD §3 step 2); it never takes a diagram id from Claude. The
 *     resolved `{ accountId, activeDiagramId }` arrives in the `TransportContext`.
 *
 * On success each tool returns the staged proposal id, the structured state the
 * edit WOULD produce, and a server-rendered SVG of it (FR-9) — so Claude, which
 * cannot see the canvas, can verify what it proposed before the human decides.
 *
 * Why rebuild a full edit instead of an incremental patch: the commit pipeline
 * and the proposal lifecycle consume a whole-scene {@link DiagramEdit} (one
 * committer, one shape). Each tool therefore loads the current editable scene,
 * applies its op as a pure transform, and stages the resulting full edit. The
 * edit is identical to what the manual canvas would commit, so both paths share
 * exactly one validator and one persist path.
 */
import { z } from "zod";
import type { TransportContext } from "@/lib/claude-transport";
import type { JsonObject } from "@/lib/types";
import { isSymbolId, type SymbolId } from "@/lib/symbols";
import { renderDiagramSvg } from "@/lib/diagram/render-svg";
import type { DiagramEdit } from "@/lib/diagram/commit";
import {
  ProposalError,
  type ProposalService,
} from "@/lib/proposals";
import {
  buildCanonicalState,
  type ConnectionState,
  type EquipmentState,
} from "./canonical-state";
import {
  McpReadError,
  type ActiveDiagram,
  type ActiveDiagramSource,
} from "./active-diagram-source";
import { McpProposeError } from "./propose-error";
import {
  applyOp,
  editFromScene,
  sceneFromSnapshot,
  type ProposeOp,
} from "./scene-edit";

/** Structured view of the state a staged edit would produce (FR-9). */
export interface ProposedDiagramState {
  readonly equipment: readonly EquipmentState[];
  readonly connections: readonly ConnectionState[];
}

/**
 * Outcome of a propose tool — a discriminated union so a validator refusal is a
 * first-class result Claude can read, not an exception (FR-8). Mirrors the
 * transport seam's `ProposeResult`, enriched with the FR-9 state + SVG.
 *
 *   - `staged`   → a pending proposal row was created; `state` + `svg` show what
 *                  the human will see and (on accept) commit.
 *   - `rejected` → the validator refused at staging; `validatorReport` carries the
 *                  reasons. No proposal row, no mutation.
 */
export type ProposeToolResult =
  | {
      readonly status: "staged";
      readonly proposalId: string;
      readonly state: ProposedDiagramState;
      readonly svg: string;
    }
  | {
      readonly status: "rejected";
      readonly validatorReport: ValidatorReportView;
    };

/** Minimal shape of the validator report surfaced to Claude on a refusal. */
export interface ValidatorReportView {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly elementId: string;
    readonly message: string;
  }>;
}

// ── Tool argument schemas (Zod at all boundaries — CLAUDE.md) ────────────────

const attributesSchema = z
  .record(z.string(), z.unknown())
  .transform((v) => v as JsonObject);

const addEquipmentArgsSchema = z.object({
  equipmentType: z.string().min(1),
  x: z.number(),
  y: z.number(),
  size: z.number().positive().optional(),
  /** Element attributes (tag + required type-specific fields). */
  attributes: attributesSchema.optional(),
});
export type AddEquipmentArgs = z.infer<typeof addEquipmentArgsSchema>;

const connectArgsSchema = z.object({
  sourceElementId: z.string().min(1),
  sourcePort: z.string().min(1),
  targetElementId: z.string().min(1),
  targetPort: z.string().min(1),
  /** Dashed signal line vs solid process line. Defaults to process. */
  signal: z.boolean().optional(),
  /** Optional line id for the connector's metadata. */
  lineId: z.string().min(1).optional(),
  /**
   * Connector attributes (e.g. a process line's required `service`). Merged with
   * `lineId`. A process line that omits a required attribute is REFUSED at
   * staging (FR-8), so set them here.
   */
  attributes: attributesSchema.optional(),
});
export type ConnectArgs = z.infer<typeof connectArgsSchema>;

const setMetadataArgsSchema = z.object({
  elementId: z.string().min(1),
  attributes: attributesSchema,
});
export type SetMetadataArgs = z.infer<typeof setMetadataArgsSchema>;

const deleteElementArgsSchema = z.object({
  elementId: z.string().min(1),
});
export type DeleteElementArgs = z.infer<typeof deleteElementArgsSchema>;

const moveOrRelabelArgsSchema = z
  .object({
    elementId: z.string().min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    tag: z.string().min(1).optional(),
  })
  .refine(
    (v) => v.x !== undefined || v.y !== undefined || v.tag !== undefined,
    "Provide at least one of `x`/`y` (to move) or `tag` (to relabel).",
  );
export type MoveOrRelabelArgs = z.infer<typeof moveOrRelabelArgsSchema>;

/**
 * The propose-tool surface. Constructed once per server over the canonical
 * active-diagram source (read current state) and the proposal lifecycle (stage).
 * Each method is one MCP tool call.
 */
export class McpProposeTools {
  constructor(
    private readonly source: ActiveDiagramSource,
    private readonly proposals: ProposalService,
  ) {}

  /** `add_equipment` — place a new equipment symbol with its metadata. */
  async addEquipment(
    context: TransportContext,
    rawArgs: unknown,
  ): Promise<ProposeToolResult> {
    const args = this.parseArgs(addEquipmentArgsSchema, rawArgs);
    if (!isSymbolId(args.equipmentType)) {
      throw new McpProposeError(
        "invalid-args",
        `Unknown equipment type "${args.equipmentType}". Call ` +
          "list_equipment_types to see the available symbols, then retry.",
      );
    }
    return this.stageOp(context, { kind: "add-equipment", args });
  }

  /** `connect` — bind a new connector between two element ports. */
  async connect(
    context: TransportContext,
    rawArgs: unknown,
  ): Promise<ProposeToolResult> {
    const args = this.parseArgs(connectArgsSchema, rawArgs);
    return this.stageOp(context, { kind: "connect", args });
  }

  /** `set_metadata` — merge attributes onto an existing element. */
  async setMetadata(
    context: TransportContext,
    rawArgs: unknown,
  ): Promise<ProposeToolResult> {
    const args = this.parseArgs(setMetadataArgsSchema, rawArgs);
    return this.stageOp(context, { kind: "set-metadata", args });
  }

  /** `delete_element` — remove an element and any connections incident on it. */
  async deleteElement(
    context: TransportContext,
    rawArgs: unknown,
  ): Promise<ProposeToolResult> {
    const args = this.parseArgs(deleteElementArgsSchema, rawArgs);
    return this.stageOp(context, { kind: "delete-element", args });
  }

  /** `move_or_relabel` — reposition an element and/or change its tag. */
  async moveOrRelabel(
    context: TransportContext,
    rawArgs: unknown,
  ): Promise<ProposeToolResult> {
    const args = this.parseArgs(moveOrRelabelArgsSchema, rawArgs);
    return this.stageOp(context, { kind: "move-or-relabel", args });
  }

  /**
   * The shared staging path every propose tool runs:
   *   1. load the account's active diagram (current canonical state),
   *   2. apply the op as a pure transform → the next full editable scene,
   *   3. derive the whole-scene {@link DiagramEdit} from it,
   *   4. stage it through the proposal lifecycle (validates; FR-8 refuses invalid),
   *   5. shape the result (proposal id + state + SVG, or the refusal report).
   *
   * Centralizing this keeps the staged-never-applied + one-committer invariants
   * in one place (CLAUDE.md): no tool reaches the commit pipeline; all go through
   * `stage`.
   */
  private async stageOp(
    context: TransportContext,
    op: ProposeOp,
  ): Promise<ProposeToolResult> {
    const active = await this.loadActive(context);
    const scene = sceneFromSnapshot(active);
    // `applyOp` throws `McpProposeError` for an op naming a missing element (a
    // bad request, not an invalid diagram); that propagates to the caller.
    const next = applyOp(scene, op);
    const edit = editFromScene(next);

    let proposalId: string;
    try {
      const proposal = await this.proposals.stage({
        accountId: context.accountId,
        diagramId: active.diagram.id,
        edit,
      });
      proposalId = proposal.id;
    } catch (error) {
      return this.mapStageError(error);
    }

    // Project the edit's scene back to structured state + SVG for FR-9. This is
    // the same read-side projection the read tools use, so what Claude sees here
    // matches get_active_diagram after the human accepts.
    const view = this.viewOf(edit);
    return {
      status: "staged",
      proposalId,
      state: { equipment: view.equipment, connections: view.connections },
      svg: view.svg,
    };
  }

  /** Resolve + validate the account's active diagram, mapping read-side failures
   * to propose-tool boundary errors. */
  private async loadActive(context: TransportContext): Promise<ActiveDiagram> {
    try {
      return await this.source.getActiveDiagram(context);
    } catch (error) {
      if (error instanceof McpReadError) {
        throw new McpProposeError(error.code, error.message);
      }
      throw error;
    }
  }

  /** Build the structured state + SVG the staged edit would produce, reusing the
   * read-side projection so it matches `get_active_diagram` post-accept. */
  private viewOf(edit: DiagramEdit): {
    equipment: readonly EquipmentState[];
    connections: readonly ConnectionState[];
    svg: string;
  } {
    // Project the edit through a synthetic snapshot: the edit's scene carries the
    // `pid` projection, and its elements carry the metadata.
    const state = buildCanonicalState({
      version: {
        id: PROJECTION_VERSION_ID,
        diagramId: PROJECTION_VERSION_ID,
        excalidrawScene: edit.scene,
        createdAt: "1970-01-01T00:00:00.000Z",
      },
      metadata: edit.elements.map((el) => ({
        diagramVersionId: PROJECTION_VERSION_ID,
        elementId: el.id,
        equipmentType: el.equipmentType as SymbolId,
        attributes: el.attributes,
      })),
    });
    return {
      equipment: state.equipment,
      connections: state.connections,
      svg: renderDiagramSvg(state.renderState),
    };
  }

  /** Map a `ProposalError` from staging to either a `rejected` result (FR-8:
   * validator refusal → return the report to Claude) or a thrown boundary error
   * (malformed payload / unowned diagram). */
  private mapStageError(error: unknown): ProposeToolResult {
    if (error instanceof ProposalError) {
      if (error.code === "invalid_proposal") {
        return {
          status: "rejected",
          validatorReport: toReportView(error.report),
        };
      }
      if (error.code === "not_found") {
        throw new McpProposeError("unauthorized", error.message);
      }
      // invalid_input / not_pending — the edit shape or an unknown type slipped
      // past the tool's own guard; surface as a bad-args boundary error.
      throw new McpProposeError("invalid-args", error.message);
    }
    throw error;
  }

  /** Parse tool args at the boundary; a Zod failure is an `invalid-args` error. */
  private parseArgs<T>(schema: z.ZodType<T>, rawArgs: unknown): T {
    const parsed = schema.safeParse(rawArgs);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new McpProposeError(
        "invalid-args",
        `Invalid arguments: ${first?.message ?? "the request shape is wrong"}. ` +
          "Check the tool's input schema and retry.",
      );
    }
    return parsed.data;
  }
}

/** Sentinel version id for the read-side projection of a not-yet-committed edit.
 * Never persisted; the projection only needs SOME id to satisfy the metadata
 * shape. */
const PROJECTION_VERSION_ID = "00000000-0000-4000-8000-0000000000ed";

/** Coerce an opaque validator report into the minimal view returned to Claude.
 * The report is JSON-safe by construction (validator output of primitives). */
function toReportView(report: unknown): ValidatorReportView {
  const r = report as {
    valid?: unknown;
    errors?: ReadonlyArray<{ code?: unknown; elementId?: unknown; message?: unknown }>;
  };
  const errors = Array.isArray(r?.errors) ? r.errors : [];
  return {
    valid: r?.valid === true,
    errors: errors.map((e) => ({
      code: typeof e.code === "string" ? e.code : "unknown",
      elementId: typeof e.elementId === "string" ? e.elementId : "",
      message: typeof e.message === "string" ? e.message : "",
    })),
  };
}
