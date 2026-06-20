/**
 * Tests for the MCP tool registry (DEV-1145, PRD §5.2).
 *
 * The wiring point downstream tasks (DEV-1146 read tools, DEV-1150 propose
 * tools) register into. Locks: unique-name registration, lookup, descriptor
 * listing in registration order, and the collision guard that catches two tasks
 * claiming the same tool name.
 */
import { describe, expect, it } from "vitest";
import { McpToolRegistry, type McpTool } from "./tool-registry";

function tool(name: string): McpTool {
  return {
    descriptor: { name, description: `${name} tool`, inputSchema: { type: "object" } },
    async execute() {
      return { content: [{ type: "text", text: name }] };
    },
  };
}

describe("McpToolRegistry", () => {
  it("registers and resolves a tool by name", () => {
    const registry = new McpToolRegistry().register(tool("add_equipment"));
    expect(registry.has("add_equipment")).toBe(true);
    expect(registry.get("add_equipment")?.descriptor.name).toBe("add_equipment");
    expect(registry.size).toBe(1);
  });

  it("lists descriptors in registration order", () => {
    const registry = new McpToolRegistry()
      .register(tool("get_active_diagram"))
      .register(tool("list_equipment_types"))
      .register(tool("add_equipment"));
    expect(registry.list().map((d) => d.name)).toEqual([
      "get_active_diagram",
      "list_equipment_types",
      "add_equipment",
    ]);
  });

  it("returns undefined for an unregistered tool", () => {
    expect(new McpToolRegistry().get("missing")).toBeUndefined();
    expect(new McpToolRegistry().has("missing")).toBe(false);
  });

  it("throws on a duplicate tool name (two tasks claiming one tool)", () => {
    const registry = new McpToolRegistry().register(tool("connect"));
    expect(() => registry.register(tool("connect"))).toThrowError(
      /already registered/,
    );
  });

  it("is empty for the bare skeleton", () => {
    expect(new McpToolRegistry().list()).toEqual([]);
  });
});
