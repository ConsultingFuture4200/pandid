/**
 * MCP tool registry (DEV-1145, PRD §5.2 — "MCP tool surface").
 *
 * The wiring point between the MCP server skeleton and the concrete tools that
 * downstream tasks add: read tools (DEV-1146: `get_active_diagram`,
 * `list_equipment_types`, …) and propose tools (DEV-1150: `add_equipment`,
 * `connect`, …). Each tool registers an `McpTool`; the server lists them
 * (`tools/list`) and dispatches calls (`tools/call`) without knowing any tool's
 * internals.
 *
 * Architecture invariants enforced at THIS seam (CLAUDE.md):
 *   - One committer. A tool may READ canonical state or STAGE a validated
 *     proposal; it can NEVER commit. The registry is just dispatch — it grants
 *     no mutation path. Propose-tools (DEV-1150) reach canonical state only
 *     through the `ClaudeTransport` seam (DEV-1143), which is itself
 *     propose-only.
 *   - Account-scoped. Every tool runs within a `TransportContext` (the resolved
 *     account + active diagram, DEV-1149). The registry threads that context to
 *     the tool; a tool never picks the diagram itself (PRD §3 step 2).
 *
 * The skeleton registers NO tools — that is deliberate. DEV-1145's job is the
 * mechanism (registry + dispatch); the tools are owned by later tasks and slot
 * in without editing this file (CLAUDE.md: "No two tasks edit the same file").
 */
import type { TransportContext } from "../types";
import type { ToolDescriptor } from "./protocol";

/**
 * The result a tool returns from a `tools/call`. MCP wraps tool output in a
 * `content` array of typed blocks; v1 tools return structured diagram state +
 * an SVG snapshot (FR-9), which the tool serializes into these blocks. The
 * skeleton keeps the block payload opaque — the SVG renderer (DEV-1142) and the
 * state shape are owned elsewhere. `isError` marks a tool-level failure (e.g. a
 * refused proposal, FR-8) without it being a transport/protocol error.
 */
export interface McpToolResult {
  readonly content: ReadonlyArray<Record<string, unknown>>;
  readonly isError?: boolean;
}

/**
 * A registrable MCP tool. `descriptor` is what `tools/list` returns;
 * `execute` is what `tools/call` invokes, receiving the validated raw params
 * and the account-scoped context. The registry validates params shape only at
 * the JSON-RPC envelope level — each tool is responsible for parsing its own
 * params (Zod-at-all-boundaries) inside `execute` and raising InvalidParams via
 * a thrown `McpToolError` if they don't match.
 */
export interface McpTool {
  readonly descriptor: ToolDescriptor;
  execute(
    params: Record<string, unknown>,
    context: TransportContext,
  ): Promise<McpToolResult>;
}

/** Typed failure a tool may throw to signal a protocol-level error to the caller. */
export class McpToolError extends Error {
  /** A JSON-RPC error code (see `JsonRpcErrorCode`). */
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "McpToolError";
    this.code = code;
  }
}

/**
 * Holds the set of MCP tools the server exposes. Tool names are unique; a
 * second registration under the same name is a programming error (two tasks
 * claiming the same tool) and throws rather than silently overwriting.
 */
export class McpToolRegistry {
  private readonly tools = new Map<string, McpTool>();

  /**
   * Register a tool. Throws if a tool with the same name is already registered
   * — the v1 tool surface (PRD §5.2) has fixed, unique names, so a collision is
   * a wiring bug, not a runtime condition to tolerate.
   */
  register(tool: McpTool): this {
    const name = tool.descriptor.name;
    if (this.tools.has(name)) {
      throw new Error(
        `An MCP tool named "${name}" is already registered. Tool names must ` +
          "be unique across the registry — check that two tasks aren't " +
          "registering the same tool.",
      );
    }
    this.tools.set(name, tool);
    return this;
  }

  /** True iff a tool with `name` is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Resolve a tool by name, or `undefined` if none is registered. */
  get(name: string): McpTool | undefined {
    return this.tools.get(name);
  }

  /**
   * The descriptors for every registered tool, in registration order — the
   * payload of a `tools/list` result.
   */
  list(): readonly ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => tool.descriptor);
  }

  /** Number of registered tools (diagnostics / tests). */
  get size(): number {
    return this.tools.size;
  }
}
