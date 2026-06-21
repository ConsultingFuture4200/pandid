/**
 * Public surface of the MCP server skeleton (DEV-1145, PRD §4 / FR-5).
 *
 * The Streamable HTTP MCP server core, its tool registry, and the wire-protocol
 * types. This is the import surface for:
 *   - the route handler (app/api/mcp/route.ts) — HTTP framing over `McpServer`
 *   - DEV-1146 (read tools) / DEV-1150 (propose tools) — register `McpTool`s
 *   - DEV-1147/1148 (OAuth/DCR) — inject a real `ContextResolver`
 *
 * Everything Claude-transport-specific stays under `lib/claude-transport/`
 * (CLAUDE.md critical fact #4): no MCP assumption leaks into app/canvas code, so
 * the §9 API-key fallback stays additive.
 */
export {
  MCP_PROTOCOL_VERSION,
  JSONRPC_VERSION,
  JsonRpcErrorCode,
  jsonRpcRequestSchema,
  jsonRpcSuccess,
  jsonRpcError,
} from "./protocol";
export type {
  InitializeResult,
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  ListToolsResult,
  ServerCapabilities,
  ServerInfo,
  ToolDescriptor,
} from "./protocol";

export { McpToolRegistry, McpToolError } from "./tool-registry";
export type { McpTool, McpToolResult } from "./tool-registry";

export {
  McpServer,
  denyAllContextResolver,
} from "./server";
export type {
  ContextResolver,
  McpServerOptions,
  ResolveContextInput,
} from "./server";

export { registerMcpTools } from "./register-tools";
export { createProductionContextResolver } from "./production-resolver";

import { McpServer } from "./server";
import { McpToolRegistry } from "./tool-registry";
import { registerMcpTools } from "./register-tools";
import { createProductionContextResolver } from "./production-resolver";

let cachedRegistry: McpToolRegistry | null = null;
let cachedServer: McpServer | null = null;

/**
 * The process-wide MCP tool registry, populated with the v1 tool catalog: the
 * 4 read tools (DEV-1146) and 5 propose tools (DEV-1150), registered via
 * `registerMcpTools`. Built once and cached, so `tools/list` exposes all 9 tools
 * and `tools/call` dispatches to them. The catalogs live in `lib/mcp-tools`;
 * this wiring imports them and never edits them.
 */
export function getMcpToolRegistry(): McpToolRegistry {
  cachedRegistry ??= registerMcpTools(new McpToolRegistry());
  return cachedRegistry;
}

/**
 * The process-wide MCP server the route handler drives. Built over the shared
 * (populated) registry with the PRODUCTION context resolver: each `tools/call`
 * is account-scoped by resolving the request's bearer token → account → active
 * diagram (DEV-1147/1148/1149). A missing/invalid token, or an account with no
 * active diagram, denies the call. The route handler threads the HTTP
 * `Authorization` header into `handle`, since the JSON-RPC body does not carry it.
 */
export function getMcpServer(): McpServer {
  cachedServer ??= new McpServer({
    registry: getMcpToolRegistry(),
    resolveContext: createProductionContextResolver(),
  });
  return cachedServer;
}
