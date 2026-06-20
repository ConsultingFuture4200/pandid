/**
 * MCP server core — JSON-RPC dispatch (DEV-1145, PRD §4 / FR-5).
 *
 * The framework-agnostic heart of the Streamable HTTP MCP server. It takes a
 * single parsed JSON-RPC message and produces a JSON-RPC response (or `null`
 * for a notification, which gets no response). The Next.js route handler
 * (app/api/mcp/route.ts) owns HTTP framing; this owns the protocol.
 *
 * Methods handled by the skeleton:
 *   - `initialize`            → the capability handshake (protocol version,
 *                               tools-only capabilities, server identity).
 *   - `notifications/initialized` → the client's post-handshake ack (no reply).
 *   - `ping`                  → liveness, returns an empty result.
 *   - `tools/list`            → descriptors of every registered tool.
 *   - `tools/call`            → dispatch to a registered tool's `execute`.
 *
 * `tools/list` and `tools/call` go through the `McpToolRegistry`, which the
 * skeleton leaves EMPTY — concrete tools are added by DEV-1146 (read) and
 * DEV-1150 (propose). So in the skeleton `tools/list` returns `[]` and
 * `tools/call` returns MethodNotFound for any name; that is the correct,
 * loop-closable behavior for a skeleton and is what the tests assert.
 *
 * One committer (CLAUDE.md): this server has no method that mutates canonical
 * state. Tools it dispatches to are propose-only by construction (they reach
 * state only via the `ClaudeTransport` seam, DEV-1143). There is deliberately
 * no `commit`/`accept` method on the wire — committing is the human's act in
 * the browser, on a different code path.
 */
import packageJson from "@/package.json";
import type { TransportContext } from "../types";
import {
  JsonRpcErrorCode,
  MCP_PROTOCOL_VERSION,
  type InitializeResult,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ListToolsResult,
  jsonRpcError,
  jsonRpcSuccess,
} from "./protocol";
import { McpToolError, McpToolRegistry } from "./tool-registry";

/** Human-readable server name advertised in the `initialize` handshake. */
const SERVER_NAME = "extraction-pid-coeditor";

/**
 * How a request acquires its account-scoped `TransportContext`. In the skeleton
 * (DEV-1145) auth is NOT implemented — the resolver returns `null` and any
 * `tools/call` is refused with an unauthorized error. DEV-1147/1148 wire OAuth
 * + DCR and DEV-1149 resolves account → active diagram; at that point a real
 * resolver is injected here without touching the dispatch logic.
 *
 * Keeping context resolution behind this function is the auth seam: the
 * skeleton ships a deny-by-default resolver, and the auth chain replaces it.
 */
export type ContextResolver = (
  request: JsonRpcRequest,
) => Promise<TransportContext | null>;

/** The deny-by-default resolver the skeleton ships with: no auth yet ⇒ no context. */
export const denyAllContextResolver: ContextResolver = async () => null;

/** Options for constructing an {@link McpServer}. */
export interface McpServerOptions {
  /** The tool registry to list/dispatch through. Defaults to an empty registry. */
  readonly registry?: McpToolRegistry;
  /**
   * Resolves the account-scoped context for a request. Defaults to
   * {@link denyAllContextResolver} (skeleton: no auth, so tool calls are
   * refused until DEV-1147/1148/1149 land).
   */
  readonly resolveContext?: ContextResolver;
}

/**
 * Server-level capabilities advertised at `initialize`. Tools-only, static set
 * (PRD §5.2). See `ServerCapabilities` in protocol.ts for rationale.
 */
const CAPABILITIES = { tools: { listChanged: false } } as const;

/**
 * The MCP server core. Construct once (per process / per request is both fine —
 * it holds no per-connection state in the skeleton) and call `handle` with each
 * parsed JSON-RPC message.
 */
export class McpServer {
  private readonly registry: McpToolRegistry;
  private readonly resolveContext: ContextResolver;

  constructor(options: McpServerOptions = {}) {
    this.registry = options.registry ?? new McpToolRegistry();
    this.resolveContext = options.resolveContext ?? denyAllContextResolver;
  }

  /** The protocol version this server speaks (diagnostics / health). */
  get protocolVersion(): string {
    return MCP_PROTOCOL_VERSION;
  }

  /**
   * Handle one parsed JSON-RPC message. Returns the response to send, or `null`
   * when the message is a notification (no `id`) and so takes no response.
   *
   * Never throws for protocol-level problems: an unknown method, bad params, or
   * a tool failure all come back as JSON-RPC error responses (or are swallowed
   * for notifications). This keeps the route handler simple — it always has a
   * value to serialize or `null` to answer 202.
   */
  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const isNotification = request.id === undefined;
    // For requests, `id` is present; for notifications it's absent. The wire
    // `id` for an error response on a notification would be null, but we send
    // no response for notifications, so this is only used on the request path.
    const id: JsonRpcId = request.id ?? null;

    switch (request.method) {
      case "initialize":
        return jsonRpcSuccess(id, this.initialize());

      case "notifications/initialized":
      case "notifications/cancelled":
        // Post-handshake / cancellation acks. No response per JSON-RPC.
        return null;

      case "ping":
        // MCP liveness probe → empty result object.
        return isNotification ? null : jsonRpcSuccess(id, {});

      case "tools/list":
        return isNotification ? null : jsonRpcSuccess(id, this.listTools());

      case "tools/call":
        return isNotification ? null : await this.callTool(id, request);

      default:
        if (isNotification) return null;
        return jsonRpcError(
          id,
          JsonRpcErrorCode.MethodNotFound,
          `Unknown method "${request.method}". This server implements the MCP ` +
            "Streamable HTTP surface: initialize, ping, tools/list, tools/call.",
        );
    }
  }

  /** Build the `initialize` handshake result. */
  private initialize(): InitializeResult {
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: CAPABILITIES,
      serverInfo: { name: SERVER_NAME, version: packageJson.version },
    };
  }

  /** Build the `tools/list` result from the registry. */
  private listTools(): ListToolsResult {
    return { tools: this.registry.list() };
  }

  /**
   * Dispatch a `tools/call`. Validates params shape, resolves the account-scoped
   * context (deny-by-default in the skeleton), then invokes the named tool.
   * Tool-level failures (a refused proposal, FR-8) surface as an `isError`
   * result; protocol failures (unknown tool, bad params, no auth) surface as
   * JSON-RPC errors.
   */
  private async callTool(
    id: JsonRpcId,
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse> {
    const params = request.params;
    if (params === undefined || Array.isArray(params)) {
      return jsonRpcError(
        id,
        JsonRpcErrorCode.InvalidParams,
        "tools/call requires a params object with a `name` and optional " +
          "`arguments`.",
      );
    }

    const name = params["name"];
    if (typeof name !== "string" || name.length === 0) {
      return jsonRpcError(
        id,
        JsonRpcErrorCode.InvalidParams,
        "tools/call params must include a non-empty string `name`.",
      );
    }

    const tool = this.registry.get(name);
    if (tool === undefined) {
      return jsonRpcError(
        id,
        JsonRpcErrorCode.MethodNotFound,
        `No MCP tool named "${name}" is registered.`,
      );
    }

    const rawArgs = params["arguments"];
    if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
      return jsonRpcError(
        id,
        JsonRpcErrorCode.InvalidParams,
        "tools/call `arguments` must be an object when present.",
      );
    }
    const args = (rawArgs ?? {}) as Record<string, unknown>;

    // Account scoping (PRD §3 step 2): a tool acts on the account's active
    // diagram. The skeleton has no auth, so this resolves to null and the call
    // is refused — exactly the deny-by-default posture until the auth chain
    // (DEV-1147/1148/1149) lands.
    const context = await this.resolveContext(request);
    if (context === null) {
      return jsonRpcError(
        id,
        JsonRpcErrorCode.InvalidRequest,
        "Not authorized: no authenticated account is bound to this MCP " +
          "session. Add the connector in Claude Desktop and complete the " +
          "OAuth sign-in, then retry.",
      );
    }

    try {
      const result = await tool.execute(args, context);
      return jsonRpcSuccess(id, result);
    } catch (err) {
      if (err instanceof McpToolError) {
        return jsonRpcError(id, err.code, err.message);
      }
      const message = err instanceof Error ? err.message : "Unknown tool error.";
      return jsonRpcError(
        id,
        JsonRpcErrorCode.InternalError,
        `Tool "${name}" failed: ${message}`,
      );
    }
  }
}
