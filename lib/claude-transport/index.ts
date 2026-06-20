/**
 * Public surface of the Claude-transport seam (DEV-1143, PRD §9).
 *
 * The ONLY import seam for Claude-driven editing. The MCP server (DEV-1145),
 * the propose tools (DEV-1150), and any future §9 fallback chat panel depend on
 * this `ClaudeTransport` interface + the registry — never on a concrete
 * transport or anything MCP-specific. Keeping every caller on this surface is
 * what guarantees no MCP assumption leaks into app/canvas code, so the fallback
 * stays additive rather than a rewrite.
 */
export type {
  ClaudeTransport,
  DiagramView,
  ProposeResult,
  ProposedChange,
  TransportContext,
  TransportErrorCode,
  TransportKind,
} from "./types";

export {
  TransportError,
  diagramViewSchema,
  proposeResultSchema,
  proposedChangeSchema,
  transportKindSchema,
} from "./types";

export { TransportRegistry } from "./registry";
