/**
 * Tool-registration wiring tests (DEV-1146 read + DEV-1150 propose → DEV-1145).
 *
 * Proves the catalogs in `lib/mcp-tools` are adapted to the registry's `McpTool`
 * and exposed end-to-end through the MCP server:
 *   1. `tools/list` returns all 9 v1 tools (4 read + 5 propose) with the right
 *      names and a JSON-Schema `inputSchema` on each.
 *   2. An authorized `tools/call` dispatches to a tool and returns its output as
 *      an MCP content block.
 *   3. A missing/invalid token (no resolved context) is refused.
 *
 * `list_equipment_types` is the dispatch probe: it is the one read tool that does
 * not resolve an active diagram, so it exercises the registry → tool path without
 * standing up canonical diagram state.
 */
import { describe, expect, it } from "vitest";
import type { TransportContext } from "../types";
import {
  JsonRpcErrorCode,
  type JsonRpcFailure,
  type JsonRpcRequest,
  type JsonRpcSuccess,
} from "./protocol";
import { McpServer } from "./server";
import { McpToolRegistry } from "./tool-registry";
import { registerMcpTools } from "./register-tools";

const CONTEXT: TransportContext = {
  accountId: "11111111-1111-4111-8111-111111111111",
  activeDiagramId: "22222222-2222-4222-8222-222222222222",
};

const EXPECTED_TOOL_NAMES = [
  // DEV-1146 read tools
  "get_active_diagram",
  "list_equipment_types",
  "validate_active_diagram",
  "export_line_list",
  // DEV-1150 propose tools
  "add_equipment",
  "connect",
  "set_metadata",
  "delete_element",
  "move_or_relabel",
] as const;

function req(
  method: string,
  params?: Record<string, unknown>,
  id: string | number | null = 1,
): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

describe("registerMcpTools — tools/list", () => {
  it("registers all 9 v1 tools (4 read + 5 propose)", () => {
    const registry = registerMcpTools(new McpToolRegistry());
    expect(registry.size).toBe(9);
    expect(registry.list().map((d) => d.name)).toEqual([...EXPECTED_TOOL_NAMES]);
  });

  it("exposes the 9 tools over the server's tools/list", async () => {
    const registry = registerMcpTools(new McpToolRegistry());
    const server = new McpServer({ registry });
    const res = (await server.handle(req("tools/list"))) as JsonRpcSuccess;
    const result = res.result as { tools: Array<{ name: string; inputSchema: unknown }> };
    expect(result.tools.map((t) => t.name)).toEqual([...EXPECTED_TOOL_NAMES]);
    // Every descriptor carries a JSON-Schema inputSchema (MCP wire requirement).
    for (const tool of result.tools) {
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("throws if the same registry is wired twice (unique names)", () => {
    const registry = registerMcpTools(new McpToolRegistry());
    expect(() => registerMcpTools(registry)).toThrow(/already registered/);
  });
});

describe("registerMcpTools — tools/call dispatch", () => {
  it("dispatches an authorized call to a registered tool", async () => {
    const registry = registerMcpTools(new McpToolRegistry());
    const server = new McpServer({ registry, resolveContext: async () => CONTEXT });

    const res = (await server.handle(
      req("tools/call", { name: "list_equipment_types", arguments: {} }),
    )) as JsonRpcSuccess;

    const result = res.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as {
      equipmentTypes: unknown[];
    };
    // The equipment-type palette is non-empty diagram-independent data.
    expect(Array.isArray(payload.equipmentTypes)).toBe(true);
    expect(payload.equipmentTypes.length).toBeGreaterThan(0);
  });

  it("refuses a call when no context resolves (missing/invalid token)", async () => {
    const registry = registerMcpTools(new McpToolRegistry());
    // Default resolver denies: no Authorization → no account → no context.
    const server = new McpServer({ registry });
    const res = (await server.handle(
      req("tools/call", { name: "list_equipment_types", arguments: {} }),
    )) as JsonRpcFailure;
    expect(res.error.code).toBe(JsonRpcErrorCode.InvalidRequest);
    expect(res.error.message).toContain("Not authorized");
  });
});
