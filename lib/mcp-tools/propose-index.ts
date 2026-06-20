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
import { getProposalService, type ProposalService } from "@/lib/proposals";
import {
  DiagramServiceActiveSource,
  type ActiveDiagramSource,
} from "./active-diagram-source";
import { McpProposeTools } from "./propose-tools";

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
 * Convenience: the process-wide propose tools over the canonical diagram service
 * (current-state source) and the proposal lifecycle (staging gate). The MCP
 * skeleton (DEV-1145) calls this to obtain the registered propose tools.
 */
export function getMcpProposeTools(
  source?: ActiveDiagramSource,
  proposals?: ProposalService,
): McpProposeTools {
  const diagrams: DiagramService = getDiagramService();
  return new McpProposeTools(
    source ?? new DiagramServiceActiveSource(diagrams),
    proposals ?? getProposalService(),
  );
}
