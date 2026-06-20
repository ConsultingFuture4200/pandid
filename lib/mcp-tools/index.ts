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
  DiagramServiceActiveSource,
  type ActiveDiagramSource,
} from "./active-diagram-source";
import { McpReadTools } from "./tools";

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
  ValidateActiveDiagramResult,
} from "./tools";

export { buildReadToolDescriptors } from "./registry";
export type { ReadToolDescriptor } from "./registry";

/**
 * Convenience: the process-wide read tools over the canonical diagram service.
 * The MCP skeleton (DEV-1145) calls this to obtain the registered read tools.
 */
export function getMcpReadTools(
  source?: ActiveDiagramSource,
): McpReadTools {
  const diagrams: DiagramService = getDiagramService();
  return new McpReadTools(source ?? new DiagramServiceActiveSource(diagrams));
}
