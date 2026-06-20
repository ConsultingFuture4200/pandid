/**
 * Tests for the MCP server skeleton (DEV-1145, PRD §4 / FR-5).
 *
 * These lock the skeleton's contract — the Streamable HTTP MCP surface a human
 * will later connect Claude Desktop to (the 🔴 hand-off in
 * docs/HUMAN-VERIFY-DEV-1145.md). They assert:
 *   1. JSON-RPC framing: success/error envelope shapes, notifications get no
 *      response, unknown methods are MethodNotFound.
 *   2. The `initialize` handshake advertises the right protocol version,
 *      tools-only capabilities, and server identity.
 *   3. `tools/list` reflects the registry (empty in the skeleton; populated once
 *      a tool registers — proving downstream tasks wire in without edits here).
 *   4. `tools/call` is account-scoped and deny-by-default: with no auth it is
 *      refused; with a resolved context it dispatches to the named tool; a
 *      tool's `isError` result is preserved (FR-8) and a thrown `McpToolError`
 *      becomes a JSON-RPC error.
 *   5. One-committer invariant is structural: the wire surface exposes no
 *      commit/accept method.
 */
import { describe, expect, it } from "vitest";
import type { TransportContext } from "../types";
import {
  JsonRpcErrorCode,
  MCP_PROTOCOL_VERSION,
  type JsonRpcFailure,
  type JsonRpcRequest,
  type JsonRpcSuccess,
} from "./protocol";
import { McpServer } from "./server";
import {
  McpToolError,
  McpToolRegistry,
  type McpTool,
} from "./tool-registry";

const CONTEXT: TransportContext = {
  accountId: "11111111-1111-4111-8111-111111111111",
  activeDiagramId: "22222222-2222-4222-8222-222222222222",
};

function req(
  method: string,
  params?: Record<string, unknown>,
  id: string | number | null = 1,
): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

function notification(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: "2.0", method, ...(params ? { params } : {}) };
}

/** A trivial tool used to prove registration + dispatch end to end. */
function makeEchoTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    descriptor: {
      name: "echo",
      description: "Echo the diagram context back (test tool).",
      inputSchema: { type: "object", properties: {}, additionalProperties: true },
    },
    async execute(params, context) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ params, accountId: context.accountId }) },
        ],
      };
    },
    ...overrides,
  };
}

describe("McpServer — handshake & liveness", () => {
  it("initialize returns the protocol version, tools-only capabilities, and serverInfo", async () => {
    const server = new McpServer();
    const res = (await server.handle(req("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" },
    }))) as JsonRpcSuccess;

    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    const result = res.result as {
      protocolVersion: string;
      capabilities: { tools: { listChanged: boolean } };
      serverInfo: { name: string; version: string };
    };
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(result.serverInfo.name).toBe("extraction-pid-coeditor");
    expect(result.serverInfo.version).toMatch(/\d+\.\d+\.\d+/);
  });

  it("ping returns an empty result", async () => {
    const server = new McpServer();
    const res = (await server.handle(req("ping"))) as JsonRpcSuccess;
    expect(res.result).toEqual({});
  });

  it("notifications/initialized gets no response", async () => {
    const server = new McpServer();
    expect(await server.handle(notification("notifications/initialized"))).toBeNull();
  });

  it("an unknown notification is swallowed (no response)", async () => {
    const server = new McpServer();
    expect(await server.handle(notification("notifications/somethingElse"))).toBeNull();
  });

  it("exposes the MCP protocol revision (Streamable HTTP, 2025-11-25)", () => {
    expect(new McpServer().protocolVersion).toBe("2025-11-25");
  });
});

describe("McpServer — method routing", () => {
  it("an unknown method returns MethodNotFound", async () => {
    const server = new McpServer();
    const res = (await server.handle(req("does/notExist"))) as JsonRpcFailure;
    expect(res.error.code).toBe(JsonRpcErrorCode.MethodNotFound);
    expect(res.error.message).toContain("Unknown method");
  });

  it("the wire surface exposes no commit/accept method (one committer)", async () => {
    // The human is the sole committer (CLAUDE.md). The server must not answer a
    // commit/accept/apply method — those names resolve to MethodNotFound, never
    // to a mutation.
    const server = new McpServer();
    for (const method of ["commit", "accept", "apply", "diagram/commit"]) {
      const res = (await server.handle(req(method))) as JsonRpcFailure;
      expect(res.error.code).toBe(JsonRpcErrorCode.MethodNotFound);
    }
  });
});

describe("McpServer — tools/list", () => {
  it("returns an empty tool list for the bare skeleton", async () => {
    const server = new McpServer();
    const res = (await server.handle(req("tools/list"))) as JsonRpcSuccess;
    expect(res.result).toEqual({ tools: [] });
  });

  it("reflects tools registered into the registry (downstream wiring point)", async () => {
    const registry = new McpToolRegistry().register(makeEchoTool());
    const server = new McpServer({ registry });
    const res = (await server.handle(req("tools/list"))) as JsonRpcSuccess;
    const result = res.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((t) => t.name)).toEqual(["echo"]);
  });
});

describe("McpServer — tools/call (account-scoped, deny-by-default)", () => {
  it("refuses a tool call when no context is resolved (skeleton: no auth)", async () => {
    const registry = new McpToolRegistry().register(makeEchoTool());
    // Default resolver denies — the skeleton ships no auth.
    const server = new McpServer({ registry });
    const res = (await server.handle(
      req("tools/call", { name: "echo", arguments: {} }),
    )) as JsonRpcFailure;
    expect(res.error.code).toBe(JsonRpcErrorCode.InvalidRequest);
    expect(res.error.message).toContain("Not authorized");
  });

  it("dispatches to the named tool once a context resolves (auth-chain seam)", async () => {
    const registry = new McpToolRegistry().register(makeEchoTool());
    const server = new McpServer({
      registry,
      resolveContext: async () => CONTEXT,
    });
    const res = (await server.handle(
      req("tools/call", { name: "echo", arguments: { foo: "bar" } }),
    )) as JsonRpcSuccess;
    const result = res.result as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0].text) as {
      params: Record<string, unknown>;
      accountId: string;
    };
    expect(payload.params).toEqual({ foo: "bar" });
    expect(payload.accountId).toBe(CONTEXT.accountId);
  });

  it("returns MethodNotFound for an unregistered tool name", async () => {
    const server = new McpServer({ resolveContext: async () => CONTEXT });
    const res = (await server.handle(
      req("tools/call", { name: "nope" }),
    )) as JsonRpcFailure;
    expect(res.error.code).toBe(JsonRpcErrorCode.MethodNotFound);
  });

  it("rejects tools/call with a missing or non-string name (InvalidParams)", async () => {
    const server = new McpServer({ resolveContext: async () => CONTEXT });
    const res = (await server.handle(req("tools/call", { arguments: {} }))) as JsonRpcFailure;
    expect(res.error.code).toBe(JsonRpcErrorCode.InvalidParams);
  });

  it("rejects tools/call when arguments is not an object", async () => {
    const registry = new McpToolRegistry().register(makeEchoTool());
    const server = new McpServer({ registry, resolveContext: async () => CONTEXT });
    const res = (await server.handle(
      req("tools/call", { name: "echo", arguments: [1, 2, 3] }),
    )) as JsonRpcFailure;
    expect(res.error.code).toBe(JsonRpcErrorCode.InvalidParams);
  });

  it("preserves a tool's isError result (a refused proposal, FR-8)", async () => {
    const registry = new McpToolRegistry().register(
      makeEchoTool({
        async execute() {
          return {
            content: [{ type: "text", text: "validator refused: duplicate tag" }],
            isError: true,
          };
        },
      }),
    );
    const server = new McpServer({ registry, resolveContext: async () => CONTEXT });
    const res = (await server.handle(
      req("tools/call", { name: "echo" }),
    )) as JsonRpcSuccess;
    expect((res.result as { isError?: boolean }).isError).toBe(true);
  });

  it("maps a thrown McpToolError to a JSON-RPC error", async () => {
    const registry = new McpToolRegistry().register(
      makeEchoTool({
        async execute() {
          throw new McpToolError(JsonRpcErrorCode.InvalidParams, "bad tag");
        },
      }),
    );
    const server = new McpServer({ registry, resolveContext: async () => CONTEXT });
    const res = (await server.handle(
      req("tools/call", { name: "echo" }),
    )) as JsonRpcFailure;
    expect(res.error.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(res.error.message).toBe("bad tag");
  });

  it("maps an unexpected throw to InternalError", async () => {
    const registry = new McpToolRegistry().register(
      makeEchoTool({
        async execute() {
          throw new Error("boom");
        },
      }),
    );
    const server = new McpServer({ registry, resolveContext: async () => CONTEXT });
    const res = (await server.handle(
      req("tools/call", { name: "echo" }),
    )) as JsonRpcFailure;
    expect(res.error.code).toBe(JsonRpcErrorCode.InternalError);
    expect(res.error.message).toContain("boom");
  });
});
