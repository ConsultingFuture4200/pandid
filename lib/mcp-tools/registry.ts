/**
 * MCP read-tool registry (DEV-1146).
 *
 * Declarative descriptors for the four read tools, so the MCP server skeleton
 * (DEV-1145) registers them by iterating this list instead of hard-wiring four
 * call sites. Each descriptor carries the MCP tool name, a human description, a
 * read-only flag, and a `call` that runs the tool for a resolved transport
 * context. The descriptor surface is transport-agnostic: it returns plain JSON
 * the MCP layer serializes into a tool result.
 *
 * Keeping the registry here (not in the MCP endpoint) means the read tools own
 * their own catalog — adding a read tool is a change in this module alone, and
 * the MCP skeleton stays a thin adapter (CLAUDE.md: no MCP assumptions leak into
 * app code; the transport seam stays additive).
 */
import type { TransportContext } from "@/lib/claude-transport";
import type { JsonObject } from "@/lib/types";
import type { McpReadTools } from "./tools";

/**
 * A registered read tool. `requiresActiveDiagram` lets the MCP layer short-circuit
 * with a clear message when no diagram is active for tools that need one
 * (everything except `list_equipment_types`).
 */
export interface ReadToolDescriptor {
  /** MCP tool name exposed to Claude Desktop. */
  readonly name: string;
  /** One-line description for the tool catalog. */
  readonly description: string;
  /** Always true here — these tools never mutate canonical state. */
  readonly readOnly: true;
  /** Whether the tool resolves the account's active diagram. */
  readonly requiresActiveDiagram: boolean;
  /** Run the tool for a resolved transport context; returns JSON-safe output. */
  call(context: TransportContext): Promise<JsonObject>;
}

/** As a JsonObject so the MCP layer serializes tool output without a transform. */
function asJson<T>(value: T): JsonObject {
  return value as unknown as JsonObject;
}

/**
 * Build the read-tool descriptors over a constructed `McpReadTools`. The MCP
 * skeleton registers each descriptor's `name` and dispatches to `call`.
 */
export function buildReadToolDescriptors(
  tools: McpReadTools,
): readonly ReadToolDescriptor[] {
  return [
    {
      name: "get_active_diagram",
      description:
        "Read the account's active diagram as structured state (equipment + " +
        "connections) plus a server-rendered SVG snapshot. Read-only.",
      readOnly: true,
      requiresActiveDiagram: true,
      call: async (context) => asJson(await tools.getActiveDiagram(context)),
    },
    {
      name: "list_equipment_types",
      description:
        "List the available extraction-equipment and connector types and their " +
        "required attributes. Read-only.",
      readOnly: true,
      requiresActiveDiagram: false,
      call: async () => asJson(tools.listEquipmentTypes()),
    },
    {
      name: "validate_active_diagram",
      description:
        "Run the deterministic connectivity validator over the active diagram " +
        "and return the report plus an SVG snapshot. Read-only — never commits.",
      readOnly: true,
      requiresActiveDiagram: true,
      call: async (context) => asJson(await tools.validateActiveDiagram(context)),
    },
    {
      name: "export_line_list",
      description:
        "Export the line list (connections with endpoint tags) derived from the " +
        "active diagram, plus an SVG snapshot. Read-only.",
      readOnly: true,
      requiresActiveDiagram: true,
      call: async (context) => asJson(await tools.exportLineList(context)),
    },
  ];
}
