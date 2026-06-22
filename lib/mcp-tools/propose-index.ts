/**
 * Public surface of the MCP propose tools (DEV-1150, PRD §5.2, FR-7,8).
 *
 * The MCP server skeleton (DEV-1145) imports from here to register the five
 * mutating tools (`add_equipment`, `connect`, `set_metadata`, `delete_element`,
 * `move_or_relabel`). Kept separate from the read-tool surface (`./index`, owned
 * by DEV-1146) so neither task edits the other's file (CLAUDE.md task-graph rule).
 *
 * Every tool here STAGES a validated proposal and never commits (CLAUDE.md: one
 * committer; proposals staged, never applied). The convenience factory wires the
 * tools over the canonical diagram service (read current state) and the proposal
 * lifecycle (stage) — the same single-committer plumbing the manual path uses.
 */
import { getDiagramService, type DiagramService } from "@/lib/diagram";
import {
  getProposalService,
  type MaterializeEdit,
  type ProposalService,
} from "@/lib/proposals";
import type { DiagramEdit } from "@/lib/diagram/commit";
import {
  DiagramServiceActiveSource,
  type ActiveDiagramSource,
} from "./active-diagram-source";
import { McpProposeTools } from "./propose-tools";
import { applyOp, editFromScene, sceneFromSnapshot } from "./scene-edit";
import { parseProposeOp } from "./propose-ops";
import { McpProposeError } from "./propose-error";

export { McpProposeError } from "./propose-error";
export type { McpProposeErrorCode } from "./propose-error";

export { McpProposeTools } from "./propose-tools";
export type {
  AddEquipmentArgs,
  ConnectArgs,
  DeleteElementArgs,
  MoveOrRelabelArgs,
  ProposeToolResult,
  ProposedDiagramState,
  SetMetadataArgs,
  ValidatorReportView,
} from "./propose-tools";

export { buildProposeToolDescriptors } from "./propose-registry";
export type { ProposeToolDescriptor } from "./propose-registry";

/**
 * Build the {@link MaterializeEdit} the proposal lifecycle injects for accept:
 * load the diagram's CURRENT committed scene via the active-diagram source, apply
 * the single stored op as a pure transform, and derive the whole-scene edit. This
 * is the no-clobber path — accept re-applies the delta to whatever is committed
 * NOW, so accepting one proposal never erases another already-committed one. An op
 * whose endpoint is no longer present surfaces from the commit pipeline's
 * re-validation as a blocked commit (correct: no clobber).
 *
 * Lives in `lib/mcp-tools` (which owns op application) and reaches `lib/proposals`
 * only via this injected function + the opaque stored op — the one-way layering.
 */
export function createMaterializeEdit(
  source: ActiveDiagramSource,
): MaterializeEdit {
  return async ({ accountId, diagramId, op }): Promise<DiagramEdit> => {
    const typedOp = parseProposeOp(op);
    if (typedOp === null) {
      // The op JSON does not parse to a known op shape — a hand-edited/legacy row.
      // Signal so the lifecycle falls back to the stored edit rather than commit a
      // malformed delta.
      throw new McpProposeError(
        "invalid-args",
        `The accepted proposal's stored change could not be applied (unrecognized ` +
          `operation). The diagram was not modified.`,
      );
    }
    const active = await source.getActiveDiagram({
      accountId,
      activeDiagramId: diagramId,
    });
    const committed = sceneFromSnapshot(active);
    const next = applyOp(committed, typedOp);
    return editFromScene(next);
  };
}

/**
 * Convenience: the process-wide propose tools over the canonical diagram service
 * (current-state source) and the proposal lifecycle (staging gate). The MCP
 * skeleton (DEV-1145) calls this to obtain the registered propose tools.
 *
 * The proposal service is wired with the {@link createMaterializeEdit} accept
 * path so accepting a proposal re-materializes its delta against current committed
 * state (no clobber). When a caller supplies its own `proposals`, that instance is
 * used as-is (it should already carry a materializer).
 */
export function getMcpProposeTools(
  source?: ActiveDiagramSource,
  proposals?: ProposalService,
): McpProposeTools {
  const diagrams: DiagramService = getDiagramService();
  const resolvedSource = source ?? new DiagramServiceActiveSource(diagrams);
  const resolvedProposals =
    proposals ?? getProposalService(createMaterializeEdit(resolvedSource));
  return new McpProposeTools(resolvedSource, resolvedProposals);
}

export type { MaterializeEdit } from "@/lib/proposals";
