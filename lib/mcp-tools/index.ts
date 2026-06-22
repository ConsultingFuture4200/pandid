/**
 * Public surface of the MCP read tools (DEV-1146, FR-6 / FR-9 / FR-15).
 *
 * The MCP server skeleton (DEV-1145) imports from here to register the four
 * read-only tools; the propose tools (DEV-1150) and line-list export (DEV-1156)
 * reuse the read-side projection (`buildCanonicalState`, `LineListRow`).
 *
 * Everything here is READ-ONLY by construction (CLAUDE.md "one committer"):
 * there is deliberately no commit/stage path on this surface. Mutating Claude
 * actions are the separate propose tools, which stage proposals a human accepts.
 */
import {
  getDiagramService,
  type DiagramService,
} from "@/lib/diagram";
import {
  getProposalService,
  type ProposalService,
} from "@/lib/proposals";
import type { TransportContext } from "@/lib/claude-transport";
import {
  DiagramServiceActiveSource,
  type ActiveDiagramSource,
} from "./active-diagram-source";
import { McpReadTools, type PendingOpsProvider } from "./tools";
import { parseProposeOp, type ProposeOp } from "./propose-ops";

export type {
  ActiveDiagram,
  ActiveDiagramSource,
  McpReadErrorCode,
} from "./active-diagram-source";
export {
  DiagramServiceActiveSource,
  McpReadError,
} from "./active-diagram-source";

export {
  buildCanonicalState,
  pidSceneSchema,
} from "./canonical-state";
export type {
  CanonicalState,
  ConnectionState,
  EquipmentState,
  LineListRow,
} from "./canonical-state";

export { McpReadTools } from "./tools";
export type {
  ActiveDiagramResult,
  EquipmentTypesResult,
  LineListResult,
  PendingOpsProvider,
  ValidateActiveDiagramResult,
} from "./tools";

export { buildReadToolDescriptors } from "./registry";
export type { ReadToolDescriptor } from "./registry";

/**
 * A {@link PendingOpsProvider} over the proposal lifecycle: lists the active
 * diagram's pending ops (stage order) and parses them back into typed ops, so
 * `get_active_diagram` can overlay committed + pending state.
 */
export function createPendingOpsProvider(
  proposals: ProposalService,
): PendingOpsProvider {
  return {
    async pendingOps(context: TransportContext): Promise<readonly ProposeOp[]> {
      const stored = await proposals.listPendingOps({
        accountId: context.accountId,
        diagramId: context.activeDiagramId,
      });
      const ops: ProposeOp[] = [];
      for (const json of stored) {
        const op = parseProposeOp(json);
        if (op !== null) {
          ops.push(op);
        }
      }
      return ops;
    },
  };
}

/**
 * Convenience: the process-wide read tools over the canonical diagram service.
 * The MCP skeleton (DEV-1145) calls this to obtain the registered read tools.
 *
 * `get_active_diagram` overlays pending proposals (committed + pending) via a
 * {@link PendingOpsProvider} wired over the proposal lifecycle, so Claude sees the
 * changes it staged before the human accepts. Pass an explicit `proposals` (e.g.
 * in tests) to scope the overlay; defaults to the process-wide service.
 */
export function getMcpReadTools(
  source?: ActiveDiagramSource,
  proposals?: ProposalService,
): McpReadTools {
  const diagrams: DiagramService = getDiagramService();
  const resolvedProposals = proposals ?? getProposalService();
  return new McpReadTools(
    source ?? new DiagramServiceActiveSource(diagrams),
    undefined,
    createPendingOpsProvider(resolvedProposals),
  );
}
