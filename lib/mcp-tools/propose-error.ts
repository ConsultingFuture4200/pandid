/**
 * Boundary error for the MCP propose tools (DEV-1150).
 *
 * Kept in its own module so both the tool surface (`propose-tools.ts`) and the
 * scene-edit engine (`scene-edit.ts`) can throw it without a runtime import
 * cycle (the engine imports the error here; the tools re-export it).
 *
 * A validator REFUSAL is deliberately NOT this error — a refused proposal is a
 * first-class `rejected` result so Claude can read the report and correct it
 * (FR-8). This error is only for operational boundary failures: malformed
 * arguments, an op targeting a missing element, or no/locked active diagram.
 */

/** Typed boundary failures distinct from a validator refusal (which is a result). */
export type McpProposeErrorCode =
  | "invalid-args" // malformed tool arguments / unknown equipment type
  | "element-not-found" // the op targets an element absent from the active diagram
  | "no-active-diagram" // the account has no active diagram to edit
  | "unauthorized"; // the active diagram is not owned by the calling account

/**
 * Boundary error for the propose tools. Messages say what happened + how to fix
 * (CLAUDE.md). Distinct from a validator refusal so the tool layer can map it to
 * the right MCP tool-error response.
 */
export class McpProposeError extends Error {
  readonly code: McpProposeErrorCode;
  constructor(code: McpProposeErrorCode, message: string) {
    super(message);
    this.name = "McpProposeError";
    this.code = code;
  }
}
